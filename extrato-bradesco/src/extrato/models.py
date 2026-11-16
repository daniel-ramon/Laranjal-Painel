"""Modelos do extrato e traducao do JSON do Bradesco para eles.

A resposta do banco traz tres blocos independentes, cada um com o seu proprio
`codigoRetorno`, e cobrindo faixas de data distintas:

    extratoUltimosLancamentos  D-1 e D0   (listaLancamentos: dict grupo -> lista)
    extratoLancamentosFuturos  futuro     (listaLancamentos: dict grupo -> lista)
    extratoPorPeriodo          D-2 pra tras (lstLancamentoMensal: lista plana)

Os valores vem como texto no formato pt-BR ("1.233,00") e o sinal vem separado,
em campos proprios (`sinalLancamento` / `sinalSaldo`).
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field

# Blocos da resposta
BLOCO_ULTIMOS = "extratoUltimosLancamentos"
BLOCO_FUTUROS = "extratoLancamentosFuturos"
BLOCO_PERIODO = "extratoPorPeriodo"

# Grupos dentro de listaLancamentos
GRUPO_SALDO_ANTERIOR = "Saldo Anterior"

# tipoLancamento em extratoPorPeriodo (01 = saldo anterior C/C, 05 = saldo anterior poupanca)
TIPOS_SALDO_ANTERIOR = {"01", "05"}


class Secao(StrEnum):
    """De onde o lancamento veio — preservado para rastreabilidade no relatorio."""

    PERIODO = "periodo"
    ULTIMOS = "ultimos"
    DIA = "dia"
    FUTURO = "futuro"


class ExtratoAPIError(RuntimeError):
    """O banco respondeu 200 mas com codigoRetorno de erro."""


# --------------------------------------------------------------------- parsing
def parse_valor(texto: str | None, sinal: str | None = None) -> Decimal:
    """'1.233,00' + '-' -> Decimal('-1233.00'). Vazio/None -> 0."""
    if not texto or not texto.strip():
        return Decimal("0")
    limpo = texto.strip().replace(".", "").replace(",", ".")
    try:
        valor = Decimal(limpo)
    except (ArithmeticError, ValueError):
        return Decimal("0")
    return -valor if (sinal or "").strip() == "-" else valor


def parse_data(texto: str | None) -> date | None:
    """'22/01/2025' -> date. Campos vazios ou zerados viram None."""
    if not texto or not texto.strip() or texto.strip("0/ ") == "":
        return None
    try:
        return datetime.strptime(texto.strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def _limpo(v: Any) -> str:
    return str(v).strip() if v is not None else ""


# --------------------------------------------------------------------- modelos
class Lancamento(BaseModel):
    data: date | None
    descricao: str
    complemento: str = ""
    documento: str = ""
    codigo: str = ""
    valor: Decimal
    saldo_apos: Decimal | None = None
    secao: Secao

    @property
    def credito(self) -> bool:
        return self.valor >= 0


class Conta(BaseModel):
    agencia: str = ""
    numero: str = ""
    digito: str = ""
    razao: str = ""
    nome_cliente: str = ""

    def __str__(self) -> str:
        digito = f"-{self.digito}" if self.digito else ""
        return f"{self.agencia}/{self.numero}{digito}"


class Extrato(BaseModel):
    conta: Conta
    data_inicio: date
    data_fim: date
    saldo_anterior: Decimal = Decimal("0")
    data_saldo_anterior: date | None = None
    lancamentos: list[Lancamento] = Field(default_factory=list)
    futuros: list[Lancamento] = Field(default_factory=list)
    mensagens: list[str] = Field(default_factory=list)

    # ------------------------------------------------------------- derivados
    @property
    def creditos(self) -> Decimal:
        return sum((x.valor for x in self.lancamentos if x.valor > 0), Decimal("0"))

    @property
    def debitos(self) -> Decimal:
        """Total de debitos, em valor absoluto."""
        return -sum((x.valor for x in self.lancamentos if x.valor < 0), Decimal("0"))

    @property
    def saldo_final(self) -> Decimal:
        """Prefere o saldo informado pelo banco no ultimo lancamento.

        O saldo calculado (anterior + creditos - debitos) so e usado quando o
        banco nao devolveu `valorSaldoAposLancamento` — o valor do banco e a
        fonte de verdade, inclusive porque nem todo lancamento entra no calculo.
        """
        for lanc in reversed(self.lancamentos):
            if lanc.saldo_apos is not None:
                return lanc.saldo_apos
        return self.saldo_anterior + self.creditos - self.debitos

    @property
    def vazio(self) -> bool:
        return not self.lancamentos and not self.futuros


# --------------------------------------------------------------------- traducao
def _lancamento(item: dict[str, Any], secao: Secao) -> Lancamento:
    descricao = _limpo(item.get("descritivoLancamentoCompleto")) or _limpo(
        item.get("descritivoLancamentoAbreviado")
    )
    saldo_bruto = item.get("valorSaldoAposLancamento")
    return Lancamento(
        data=parse_data(item.get("dataLancamento")),
        descricao=descricao,
        complemento=_limpo(item.get("segundaLinhalLancamento")),
        documento=_limpo(item.get("numeroDocumento")),
        codigo=_limpo(item.get("codigoLancamento")),
        valor=parse_valor(item.get("valorLancamento"), item.get("sinalLancamento")),
        saldo_apos=(
            parse_valor(saldo_bruto, item.get("sinalSaldo")) if _limpo(saldo_bruto) else None
        ),
        secao=secao,
    )


def _checar_bloco(bloco: dict[str, Any], nome: str) -> str:
    """Devolve a mensagem do bloco; levanta se o codigoRetorno indicar erro.

    Sucesso = sem codigo ou codigo composto so de zeros. A API devolve o sucesso
    ora como "0", ora como "00" (e o sandbox usava "00"); so e erro quando sobra
    algum digito diferente de zero (ex.: "04").
    """
    codigo = _limpo(bloco.get("codigoRetorno"))
    mensagem = _limpo(bloco.get("mensagem"))
    if codigo and codigo.lstrip("0"):
        raise ExtratoAPIError(f"{nome}: codigoRetorno={codigo} - {mensagem}")
    return mensagem


def parse_extrato(
    payload: dict[str, Any],
    *,
    agencia: str,
    data_inicio: date,
    data_fim: date,
) -> Extrato:
    """Traduz a resposta crua da API para um Extrato."""
    conta = Conta(agencia=agencia)
    mensagens: list[str] = []
    lancamentos: list[Lancamento] = []
    futuros: list[Lancamento] = []
    saldo_anterior = Decimal("0")
    data_saldo_anterior: date | None = None

    # ---------------------------------------------- D-2 pra tras (lista plana)
    periodo = payload.get(BLOCO_PERIODO) or {}
    if periodo:
        if msg := _checar_bloco(periodo, BLOCO_PERIODO):
            mensagens.append(msg)
        _preencher_conta(conta, periodo)
        for item in periodo.get("lstLancamentoMensal") or []:
            if _limpo(item.get("tipoLancamento")) in TIPOS_SALDO_ANTERIOR:
                saldo_anterior = parse_valor(
                    item.get("valorSaldoAposLancamento"), item.get("sinalSaldo")
                )
                data_saldo_anterior = parse_data(item.get("dataLancamento"))
                continue
            lancamentos.append(_lancamento(item, Secao.PERIODO))

    # ------------------------------------------------------- D-1 e D0 (grupos)
    ultimos = payload.get(BLOCO_ULTIMOS) or {}
    if ultimos:
        if msg := _checar_bloco(ultimos, BLOCO_ULTIMOS):
            mensagens.append(msg)
        _preencher_conta(conta, ultimos)
        for grupo, itens in (ultimos.get("listaLancamentos") or {}).items():
            if grupo == GRUPO_SALDO_ANTERIOR:
                # So vale como saldo inicial se o bloco por periodo nao trouxe um
                # mais antigo — senao sobrescreveria o inicio real da janela.
                for item in itens or []:
                    if data_saldo_anterior is None:
                        saldo_anterior = parse_valor(
                            item.get("valorSaldoAposLancamento"), item.get("sinalSaldo")
                        )
                        data_saldo_anterior = parse_data(item.get("dataLancamento"))
                continue
            secao = Secao.DIA if "Dia" in grupo else Secao.ULTIMOS
            lancamentos.extend(_lancamento(item, secao) for item in itens or [])

    # ------------------------------------------------------------- futuros
    bloco_futuros = payload.get(BLOCO_FUTUROS) or {}
    if bloco_futuros:
        if msg := _checar_bloco(bloco_futuros, BLOCO_FUTUROS):
            mensagens.append(msg)
        for itens in (bloco_futuros.get("listaLancamentos") or {}).values():
            futuros.extend(_lancamento(item, Secao.FUTURO) for item in itens or [])

    # Ordena por data mantendo a ordem original dentro do mesmo dia (o banco ja
    # devolve os lancamentos do dia na sequencia correta de saldo).
    lancamentos.sort(key=lambda x: (x.data or date.min))
    futuros.sort(key=lambda x: (x.data or date.min))

    return Extrato(
        conta=conta,
        data_inicio=data_inicio,
        data_fim=data_fim,
        saldo_anterior=saldo_anterior,
        data_saldo_anterior=data_saldo_anterior,
        lancamentos=lancamentos,
        futuros=futuros,
        mensagens=sorted(set(mensagens)),
    )


def _preencher_conta(conta: Conta, bloco: dict[str, Any]) -> None:
    conta.numero = conta.numero or _limpo(bloco.get("numeroConta"))
    conta.digito = conta.digito or _limpo(bloco.get("digitoConta"))
    conta.razao = conta.razao or _limpo(bloco.get("razaoConta"))
    conta.nome_cliente = conta.nome_cliente or _limpo(bloco.get("nomeCliente"))
