"""Testes da persistencia e da idempotencia."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from extrato.models import Lancamento, Secao
from extrato.storage import STATUS_ERRO, STATUS_OK, Storage, chave_lancamento

CONTA = "75557"


@pytest.fixture
def storage(tmp_path) -> Storage:
    return Storage(tmp_path / "sub" / "extrato.db")


def _lanc(valor: str, dia: int = 10, doc: str = "0000001", desc: str = "PIX") -> Lancamento:
    return Lancamento(
        data=date(2025, 1, dia),
        descricao=desc,
        documento=doc,
        valor=Decimal(valor),
        saldo_apos=Decimal("1000.00"),
        secao=Secao.ULTIMOS,
    )


# ------------------------------------------------------------------- lancamentos
def test_cria_o_banco_e_os_diretorios(tmp_path):
    db = tmp_path / "novo" / "extrato.db"
    Storage(db)
    assert db.exists()


def test_grava_e_conta_novos(storage):
    assert storage.gravar_lancamentos(CONTA, [_lanc("100.00"), _lanc("-50.00")]) == 2


def test_regravar_os_mesmos_nao_duplica(storage):
    lancamentos = [_lanc("100.00"), _lanc("-50.00")]
    assert storage.gravar_lancamentos(CONTA, lancamentos) == 2
    assert storage.gravar_lancamentos(CONTA, lancamentos) == 0
    assert len(storage.lancamentos_do_periodo(CONTA, date(2025, 1, 1), date(2025, 1, 31))) == 2


def test_lancamentos_identicos_no_mesmo_dia_sao_preservados(storage):
    # Duas tarifas iguais no mesmo dia sao lancamentos distintos, nao duplicata.
    iguais = [_lanc("-9.90", desc="TARIFA"), _lanc("-9.90", desc="TARIFA")]
    assert storage.gravar_lancamentos(CONTA, iguais) == 2

    # Mas reenviar a mesma remessa continua sem duplicar.
    assert storage.gravar_lancamentos(CONTA, iguais) == 0


def test_lancamento_novo_entre_conhecidos_e_detectado(storage):
    storage.gravar_lancamentos(CONTA, [_lanc("100.00")])
    assert storage.gravar_lancamentos(CONTA, [_lanc("100.00"), _lanc("200.00", dia=11)]) == 1


def test_contas_diferentes_nao_colidem(storage):
    assert storage.gravar_lancamentos(CONTA, [_lanc("100.00")]) == 1
    assert storage.gravar_lancamentos("99999", [_lanc("100.00")]) == 1


def test_lista_vazia_nao_quebra(storage):
    assert storage.gravar_lancamentos(CONTA, []) == 0


def test_leitura_preserva_decimal_e_ordem(storage):
    storage.gravar_lancamentos(CONTA, [_lanc("0.15", dia=12), _lanc("-1234.56", dia=11)])
    lidos = storage.lancamentos_do_periodo(CONTA, date(2025, 1, 1), date(2025, 1, 31))

    assert [x.data.day for x in lidos] == [11, 12]
    assert lidos[0].valor == Decimal("-1234.56")
    assert lidos[1].valor == Decimal("0.15")
    assert isinstance(lidos[0].valor, Decimal)


def test_leitura_filtra_pelo_periodo(storage):
    storage.gravar_lancamentos(CONTA, [_lanc("100.00", dia=5), _lanc("200.00", dia=20)])
    lidos = storage.lancamentos_do_periodo(CONTA, date(2025, 1, 15), date(2025, 1, 31))
    assert [x.valor for x in lidos] == [Decimal("200.00")]


def test_chave_muda_com_o_ordinal():
    lanc = _lanc("100.00")
    assert chave_lancamento(CONTA, lanc, 0) != chave_lancamento(CONTA, lanc, 1)
    assert chave_lancamento(CONTA, lanc, 0) == chave_lancamento(CONTA, lanc, 0)


# --------------------------------------------------------------------- execucao
def test_dia_so_conta_como_processado_apos_sucesso(storage):
    dia = date(2025, 1, 10)
    assert not storage.ja_processado(CONTA, dia, dia)

    execucao = storage.abrir_execucao(CONTA, dia, dia)
    assert not storage.ja_processado(CONTA, dia, dia)  # ainda em andamento

    storage.fechar_execucao(execucao, status=STATUS_OK, novos=2, total=2)
    assert storage.ja_processado(CONTA, dia, dia)


def test_execucao_com_erro_nao_bloqueia_reprocessamento(storage):
    dia = date(2025, 1, 10)
    execucao = storage.abrir_execucao(CONTA, dia, dia)
    storage.fechar_execucao(execucao, status=STATUS_ERRO, mensagem="timeout")
    assert not storage.ja_processado(CONTA, dia, dia)


def test_sucesso_em_outro_dia_nao_marca_o_dia_pedido(storage):
    outro = date(2025, 1, 9)
    execucao = storage.abrir_execucao(CONTA, outro, outro)
    storage.fechar_execucao(execucao, status=STATUS_OK)
    assert not storage.ja_processado(CONTA, date(2025, 1, 10), date(2025, 1, 10))


# ----------------------------------------------------------------------- envios
def test_registra_envio_por_destinatario(storage, tmp_path):
    dia = date(2025, 1, 10)
    execucao = storage.abrir_execucao(CONTA, dia, dia)
    storage.registrar_envio(
        execucao, canal="email", destinatario="a@x.com", status=STATUS_OK
    )
    storage.registrar_envio(
        execucao, canal="email", destinatario="b@x.com", status=STATUS_ERRO, erro="recusado"
    )

    with storage._conectar() as con:  # noqa: SLF001 - inspecao de teste
        linhas = con.execute("SELECT destinatario, status, erro FROM envio ORDER BY id").fetchall()

    assert [dict(x) for x in linhas] == [
        {"destinatario": "a@x.com", "status": STATUS_OK, "erro": None},
        {"destinatario": "b@x.com", "status": STATUS_ERRO, "erro": "recusado"},
    ]
