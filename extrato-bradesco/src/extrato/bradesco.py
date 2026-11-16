"""Cliente da API de Saldo e Extrato do Bradesco (Manual v2.2.1)."""

from __future__ import annotations

import logging
import time
from datetime import date
from typing import Any

import httpx

from .auth import TokenProvider
from .config import Settings
from .models import Extrato, parse_extrato

log = logging.getLogger(__name__)

# Limite documentado da API: 5.000 transacoes por requisicao.
LIMITE_TRANSACOES = 5_000

_TENTATIVAS = 3
_BACKOFF_BASE_S = 2.0
_STATUS_RETENTAVEIS = {429, 500, 502, 503, 504}

_MENSAGENS_HTTP = {
    400: "request invalido — revisar os parametros enviados",
    401: "sem permissao para executar o servico",
    403: "sessao expirada",
    404: "conta nao encontrada ou parametros fora do padrao esperado",
    405: "metodo HTTP incorreto",
    500: "erro interno do servico",
    503: "indisponibilidade temporaria do sistema",
}


class ExtratoHTTPError(RuntimeError):
    """A API respondeu com status de erro."""


class ClienteBradesco:
    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        self._settings = settings
        self._client = client
        self._tokens = TokenProvider(settings, client)

    def consultar_extrato(self, data_inicio: date, data_fim: date) -> Extrato:
        """Consulta o extrato no periodo e devolve o resultado ja traduzido."""
        if data_inicio > data_fim:
            raise ValueError("data_inicio nao pode ser maior que data_fim")

        s = self._settings
        params = {
            "agencia": s.agencia,
            "conta": s.conta,
            "dataInicio": data_inicio.strftime("%d%m%Y"),
            "dataFim": data_fim.strftime("%d%m%Y"),
            "tipo": s.tipo_conta,
            "tipoOperacao": s.tipo_operacao,
        }
        log.info(
            "consultando extrato da conta %s de %s a %s",
            s.conta_formatada,
            data_inicio.isoformat(),
            data_fim.isoformat(),
        )

        payload = self._get(s.statement_url, params)
        extrato = parse_extrato(
            payload, agencia=s.agencia, data_inicio=data_inicio, data_fim=data_fim
        )

        total = len(extrato.lancamentos) + len(extrato.futuros)
        if total >= LIMITE_TRANSACOES:
            log.warning(
                "retorno atingiu o limite de %s transacoes — o periodo pode estar truncado; "
                "consulte em janelas menores",
                LIMITE_TRANSACOES,
            )
        log.info("extrato recebido: %s lancamentos, %s futuros", len(extrato.lancamentos), total - len(extrato.lancamentos))
        return extrato

    def consultar_saldo(self) -> dict[str, Any]:
        """Consulta o saldo. Devolve o payload cru — usado so como diagnostico."""
        s = self._settings
        return self._get(
            s.balance_url,
            {"agencia": s.agencia, "conta": s.conta, "tipoOperacao": s.tipo_operacao},
        )

    # ------------------------------------------------------------------ interno
    def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        ultimo_erro = ""

        for tentativa in range(1, _TENTATIVAS + 1):
            token = self._tokens.get()
            resp = self._client.get(
                url,
                params=params,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Accept": "application/json",
                },
            )

            if resp.status_code == 200:
                try:
                    return resp.json()
                except ValueError as exc:
                    raise ExtratoHTTPError("resposta nao e JSON valido") from exc

            ultimo_erro = _descrever(resp)

            # 401/403 podem ser token expirado ou revogado: renova uma vez.
            if resp.status_code in (401, 403) and tentativa == 1:
                log.warning("%s — renovando token e tentando de novo", ultimo_erro)
                self._tokens.invalidar()
                continue

            if resp.status_code in _STATUS_RETENTAVEIS and tentativa < _TENTATIVAS:
                espera = _BACKOFF_BASE_S ** tentativa
                log.warning("%s — nova tentativa em %.0fs", ultimo_erro, espera)
                time.sleep(espera)
                continue

            raise ExtratoHTTPError(ultimo_erro)

        raise ExtratoHTTPError(ultimo_erro or "falha desconhecida")


def _descrever(resp: httpx.Response) -> str:
    explicacao = _MENSAGENS_HTTP.get(resp.status_code, "erro nao catalogado")
    return f"HTTP {resp.status_code} ({explicacao}): {resp.text[:300]}"
