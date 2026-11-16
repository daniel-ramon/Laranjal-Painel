"""Testes da geracao do PDF, do resumo e do expurgo."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from extrato.models import Conta, Extrato, Lancamento, Secao, parse_extrato
from extrato.report import (
    expurgar_antigos,
    formatar_brl,
    gerar_pdf,
    gerar_resumo,
    nome_arquivo,
)

FIXTURE = Path(__file__).parent / "fixtures" / "extrato_sandbox.json"


@pytest.fixture
def extrato() -> Extrato:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return parse_extrato(
        payload, agencia="3750", data_inicio=date(2024, 11, 6), data_fim=date(2024, 11, 20)
    )


# ------------------------------------------------------------------- formatacao
@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        (Decimal("1234.56"), "1.234,56"),
        (Decimal("-1234.56"), "-1.234,56"),
        (Decimal("0"), "0,00"),
        (Decimal("0.15"), "0,15"),
        (Decimal("1234567.89"), "1.234.567,89"),
        (Decimal("-0.01"), "-0,01"),
    ],
)
def test_formatar_brl(valor, esperado):
    assert formatar_brl(valor) == esperado


# -------------------------------------------------------------------------- PDF
def test_gera_pdf_valido(extrato, tmp_path):
    destino = gerar_pdf(extrato, tmp_path / "extrato.pdf")
    assert destino.exists()
    conteudo = destino.read_bytes()
    assert conteudo.startswith(b"%PDF")
    assert conteudo.rstrip().endswith(b"%%EOF")
    assert len(conteudo) > 2000


def test_gera_pdf_sem_lancamentos(tmp_path):
    vazio = Extrato(
        conta=Conta(agencia="3750", numero="75557"),
        data_inicio=date(2025, 1, 10),
        data_fim=date(2025, 1, 10),
    )
    destino = gerar_pdf(vazio, tmp_path / "vazio.pdf")
    assert destino.exists()
    assert destino.read_bytes().startswith(b"%PDF")


def test_cria_o_diretorio_de_destino(extrato, tmp_path):
    destino = gerar_pdf(extrato, tmp_path / "novo" / "sub" / "extrato.pdf")
    assert destino.exists()


def test_nome_do_arquivo_por_dia_unico(tmp_path):
    e = Extrato(
        conta=Conta(agencia="3750", numero="75557"),
        data_inicio=date(2025, 1, 10),
        data_fim=date(2025, 1, 10),
    )
    assert nome_arquivo(e, tmp_path).name == "extrato_3750-75557_2025-01-10.pdf"


def test_nome_do_arquivo_por_periodo(extrato, tmp_path):
    assert nome_arquivo(extrato, tmp_path).name == (
        "extrato_3750-75557_2024-11-06_a_2024-11-20.pdf"
    )


# ----------------------------------------------------------------------- resumo
def test_resumo_traz_os_numeros_do_extrato(extrato):
    resumo = gerar_resumo(extrato)
    assert "3750/75557-5" in resumo
    assert "80,00" in resumo  # saldo anterior
    assert "5.169,91" in resumo  # creditos
    assert "1.650,00" in resumo  # debitos
    assert "8.168,11" in resumo  # saldo final
    assert "18 lancamento(s)" in resumo
    assert "5 lancamento(s) futuro(s)" in resumo


def test_resumo_de_dia_unico_mostra_uma_data():
    e = Extrato(
        conta=Conta(agencia="3750", numero="75557"),
        data_inicio=date(2025, 1, 10),
        data_fim=date(2025, 1, 10),
        lancamentos=[
            Lancamento(
                data=date(2025, 1, 10),
                descricao="PIX",
                valor=Decimal("10.00"),
                secao=Secao.DIA,
            )
        ],
    )
    resumo = gerar_resumo(e)
    assert "10/01/2025" in resumo
    assert " a " not in resumo.splitlines()[0]


def test_resumo_sem_futuros_omite_a_linha():
    e = Extrato(
        conta=Conta(agencia="3750", numero="75557"),
        data_inicio=date(2025, 1, 10),
        data_fim=date(2025, 1, 10),
    )
    assert "futuro" not in gerar_resumo(e)


# ---------------------------------------------------------------------- expurgo
def _pdf_com_idade(pasta: Path, nome: str, dias: int) -> Path:
    caminho = pasta / nome
    caminho.write_bytes(b"%PDF-fake")
    quando = (datetime.now() - timedelta(days=dias)).timestamp()
    import os

    os.utime(caminho, (quando, quando))
    return caminho


def test_expurga_so_os_antigos(tmp_path):
    velho = _pdf_com_idade(tmp_path, "extrato_a.pdf", dias=120)
    novo = _pdf_com_idade(tmp_path, "extrato_b.pdf", dias=10)

    assert expurgar_antigos(tmp_path, dias=90) == 1
    assert not velho.exists()
    assert novo.exists()


def test_expurgo_ignora_arquivos_de_fora_do_padrao(tmp_path):
    outro = tmp_path / "relatorio.pdf"
    outro.write_bytes(b"%PDF-fake")
    import os

    quando = (datetime.now() - timedelta(days=500)).timestamp()
    os.utime(outro, (quando, quando))

    assert expurgar_antigos(tmp_path, dias=90) == 0
    assert outro.exists()


def test_retencao_zero_desliga_o_expurgo(tmp_path):
    velho = _pdf_com_idade(tmp_path, "extrato_a.pdf", dias=999)
    assert expurgar_antigos(tmp_path, dias=0) == 0
    assert velho.exists()


def test_expurgo_em_diretorio_inexistente_nao_quebra(tmp_path):
    assert expurgar_antigos(tmp_path / "nao-existe", dias=90) == 0
