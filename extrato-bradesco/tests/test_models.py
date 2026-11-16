"""Testes da traducao do JSON do Bradesco, incluindo o fixture real do sandbox."""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from extrato.models import (
    ExtratoAPIError,
    Secao,
    parse_data,
    parse_extrato,
    parse_valor,
)

FIXTURE = Path(__file__).parent / "fixtures" / "extrato_sandbox.json"


@pytest.fixture
def payload() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture
def extrato(payload):
    return parse_extrato(
        payload, agencia="3750", data_inicio=date(2024, 11, 6), data_fim=date(2024, 11, 20)
    )


# ------------------------------------------------------------------- primitivas
@pytest.mark.parametrize(
    ("texto", "sinal", "esperado"),
    [
        ("1.233,00", "+", Decimal("1233.00")),
        ("1.233,00", "-", Decimal("-1233.00")),
        ("0,00", "", Decimal("0")),
        ("8.168,11", None, Decimal("8168.11")),
        ("", "+", Decimal("0")),
        (None, "+", Decimal("0")),
        ("   ", "-", Decimal("0")),
        ("lixo", "+", Decimal("0")),
    ],
)
def test_parse_valor(texto, sinal, esperado):
    assert parse_valor(texto, sinal) == esperado


@pytest.mark.parametrize(
    ("texto", "esperado"),
    [
        ("22/01/2025", date(2025, 1, 22)),
        ("  30/09/2024 ", date(2024, 9, 30)),
        ("00/00/0000", None),
        ("", None),
        (None, None),
        ("2025-01-22", None),
    ],
)
def test_parse_data(texto, esperado):
    assert parse_data(texto) == esperado


# --------------------------------------------------------------- fixture real
def test_identifica_a_conta(extrato):
    assert extrato.conta.agencia == "3750"
    assert extrato.conta.numero == "75557"
    assert extrato.conta.digito == "5"
    assert extrato.conta.nome_cliente == "CONTA AMBIENTE TU"
    assert str(extrato.conta) == "3750/75557-5"


def test_saldo_anterior_vem_do_bloco_mais_antigo(extrato):
    # extratoPorPeriodo cobre D-2 pra tras, entao o saldo inicial e o dele —
    # nao o "Saldo Anterior" de extratoUltimosLancamentos, que e bem posterior.
    assert extrato.saldo_anterior == Decimal("80.00")
    assert extrato.data_saldo_anterior == date(2024, 9, 30)


def test_saldo_anterior_nao_entra_como_lancamento(extrato):
    assert all(x.descricao != "Saldo Anterior" for x in extrato.lancamentos)


def test_lancamentos_ordenados_por_data(extrato):
    datas = [x.data for x in extrato.lancamentos]
    assert datas == sorted(datas)


def test_sinal_do_lancamento_e_aplicado(extrato):
    primeiro = extrato.lancamentos[0]
    assert primeiro.data == date(2024, 10, 1)
    assert primeiro.valor == Decimal("-700.00")
    assert not primeiro.credito
    assert primeiro.saldo_apos == Decimal("-620.00")


def test_totais_e_saldo_final(extrato):
    assert extrato.creditos == Decimal("5169.91")
    assert extrato.debitos == Decimal("1650.00")
    # saldo final vem do banco (ultimo valorSaldoAposLancamento), nao do calculo
    assert extrato.saldo_final == Decimal("8168.11")


def test_separa_secoes(extrato):
    secoes = {x.secao for x in extrato.lancamentos}
    assert Secao.PERIODO in secoes
    assert Secao.ULTIMOS in secoes
    assert Secao.DIA in secoes
    assert all(x.secao is Secao.FUTURO for x in extrato.futuros)


def test_futuros_ficam_fora_dos_totais(extrato):
    assert len(extrato.futuros) == 5
    assert all(x not in extrato.lancamentos for x in extrato.futuros)
    # nenhum futuro tem saldo apos lancamento no layout da API
    assert all(x.saldo_apos is None for x in extrato.futuros)


def test_descricao_prefere_a_completa(extrato):
    pix = next(x for x in extrato.lancamentos if x.documento == "0936269")
    assert pix.descricao == "TRANSFERENCIA PIX"
    assert pix.complemento.startswith("REM: EMPRESA PAGADOR")


def test_nao_esta_vazio(extrato):
    assert not extrato.vazio


# ------------------------------------------------------------------ degradados
def test_payload_vazio_gera_extrato_vazio():
    e = parse_extrato({}, agencia="3750", data_inicio=date(2025, 1, 1), data_fim=date(2025, 1, 1))
    assert e.vazio
    assert e.saldo_anterior == Decimal("0")
    assert e.saldo_final == Decimal("0")


def test_codigo_retorno_de_erro_levanta():
    payload = {
        "extratoUltimosLancamentos": {
            "codigoRetorno": "12",
            "mensagem": "CTAS9999 - CONTA INVALIDA",
            "listaLancamentos": {},
        }
    }
    with pytest.raises(ExtratoAPIError, match="CONTA INVALIDA"):
        parse_extrato(
            payload, agencia="3750", data_inicio=date(2025, 1, 1), data_fim=date(2025, 1, 1)
        )


def test_saldo_final_cai_para_o_calculo_quando_banco_nao_informa():
    payload = {
        "extratoUltimosLancamentos": {
            "codigoRetorno": "00",
            "listaLancamentos": {
                "Ultimos Lancamentos": [
                    {
                        "dataLancamento": "10/01/2025",
                        "valorLancamento": "100,00",
                        "sinalLancamento": "+",
                        "descritivoLancamentoCompleto": "CREDITO",
                    },
                    {
                        "dataLancamento": "11/01/2025",
                        "valorLancamento": "30,00",
                        "sinalLancamento": "-",
                        "descritivoLancamentoCompleto": "DEBITO",
                    },
                ]
            },
        }
    }
    e = parse_extrato(
        payload, agencia="3750", data_inicio=date(2025, 1, 10), data_fim=date(2025, 1, 11)
    )
    assert e.creditos == Decimal("100.00")
    assert e.debitos == Decimal("30.00")
    assert e.saldo_final == Decimal("70.00")
