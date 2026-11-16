"""Autenticacao nas APIs do Bradesco (Manual do Desenvolvedor "mTLS" v1.0.0).

O fluxo e OAuth 2.0 `client_credentials` puro sobre mTLS — nao ha JWT assertion:

    POST {host}/auth/server-mtls/v2/token
    Content-Type: application/x-www-form-urlencoded
    grant_type=client_credentials&client_id=...&client_secret=...

O certificado de cliente (mTLS) precisa ser exatamente o mesmo usado na geracao
da credencial no portal; caso contrario o banco responde 401
"SSL with client authentication is required".

O token vale 1 hora e o manual alerta que gerar tokens em excesso pode acionar
restricoes de seguranca — por isso o TokenProvider cacheia e reusa.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

import httpx

from .config import Settings

log = logging.getLogger(__name__)

GRANT_TYPE = "client_credentials"

# Renova com folga, para nao esbarrar em expiracao no meio de uma sequencia de chamadas.
_MARGEM_RENOVACAO_S = 60


class AuthError(RuntimeError):
    """Falha ao obter o access_token."""


@dataclass(frozen=True)
class Token:
    access_token: str
    expira_em: float  # epoch

    @property
    def valido(self) -> bool:
        return time.time() < self.expira_em - _MARGEM_RENOVACAO_S


class TokenProvider:
    """Obtem e cacheia o access_token.

    O cache e em memoria (uma instancia por execucao) E em disco
    (settings.token_cache_path), porque a ponte do painel abre um processo Python
    novo a cada consulta — sem o cache em disco, cada abertura da pagina geraria um
    token, e o manual alerta que gerar tokens em excesso aciona bloqueio.
    """

    def __init__(self, settings: Settings, client: httpx.Client) -> None:
        self._settings = settings
        self._client = client
        self._token: Token | None = self._carregar_cache()

    def get(self, *, forcar: bool = False) -> str:
        if not forcar and self._token is not None and self._token.valido:
            return self._token.access_token
        self._token = self._solicitar()
        self._salvar_cache(self._token)
        return self._token.access_token

    def invalidar(self) -> None:
        """Chamado apos um 401, para forcar nova autenticacao na proxima tentativa.

        Remove tambem o cache em disco, para a proxima execucao nao reusar um token
        que o banco ja rejeitou.
        """
        self._token = None
        try:
            self._settings.token_cache_path.unlink(missing_ok=True)
        except OSError:
            pass

    # ------------------------------------------------------------- cache em disco
    def _carregar_cache(self) -> Token | None:
        caminho = self._settings.token_cache_path
        try:
            dados = json.loads(caminho.read_text(encoding="utf-8"))
            token = Token(
                access_token=str(dados["access_token"]),
                expira_em=float(dados["expira_em"]),
            )
        except (OSError, ValueError, KeyError, TypeError):
            return None
        if token.valido:
            log.info("reaproveitando access_token em cache (restam %.0fs)", token.expira_em - time.time())
            return token
        return None

    def _salvar_cache(self, token: Token) -> None:
        caminho = self._settings.token_cache_path
        try:
            caminho.parent.mkdir(parents=True, exist_ok=True)
            caminho.write_text(
                json.dumps({"access_token": token.access_token, "expira_em": token.expira_em}),
                encoding="utf-8",
            )
        except OSError as exc:
            log.warning("nao foi possivel gravar o cache de token: %s", exc)

    # ------------------------------------------------------------------ interno
    def _solicitar(self) -> Token:
        log.info("solicitando access_token em %s", self._settings.token_url)

        try:
            resp = self._client.post(
                self._settings.token_url,
                data={
                    "grant_type": GRANT_TYPE,
                    "client_id": self._settings.client_id,
                    "client_secret": self._settings.client_secret.get_secret_value(),
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        except httpx.HTTPError as exc:
            raise AuthError(f"falha de rede ao obter token: {exc}") from exc

        if resp.status_code != 200:
            raise AuthError(_explicar_falha(resp))

        try:
            dados = resp.json()
        except ValueError as exc:
            raise AuthError("resposta do token nao e JSON valido") from exc

        access_token = dados.get("access_token")
        if not access_token:
            raise AuthError(f"resposta do token sem access_token: {sorted(dados)}")

        expires_in = int(dados.get("expires_in", 3600))
        log.info("access_token obtido, expira em %ss", expires_in)
        return Token(access_token=access_token, expira_em=time.time() + expires_in)


def _explicar_falha(resp: httpx.Response) -> str:
    """Traduz os erros catalogados no FAQ do manual para algo acionavel.

    O corpo de erro do Bradesco nao contem segredo, entao pode ir para o log.
    """
    corpo = resp.text[:500]
    dica = ""
    if "SSL with client authentication" in corpo:
        dica = (
            " -> o certificado usado no mTLS nao e o mesmo cadastrado na geracao "
            "da credencial no portal"
        )
    elif "client credentials were not valid" in corpo:
        dica = " -> client_id/client_secret incorretos ou de outro ambiente"
    return f"token recusado (HTTP {resp.status_code}): {corpo}{dica}"


def criar_http_client(settings: Settings) -> httpx.Client:
    """Client httpx com mTLS (certificado de cliente) e timeout explicito."""
    return httpx.Client(
        cert=(str(settings.cert_path), str(settings.key_path)),
        timeout=settings.http_timeout,
        follow_redirects=False,
    )
