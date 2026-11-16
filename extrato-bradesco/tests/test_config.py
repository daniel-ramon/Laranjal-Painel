"""Testes da configuracao."""

from __future__ import annotations

from extrato.config import Settings


def _base(**over) -> Settings:
    dados = dict(
        _env_file=None,
        client_id="cid",
        client_secret="csec",
        token_url="https://exemplo.invalido/token",
    )
    dados.update(over)
    return Settings(**dados)


def test_destinatarios_aceita_lista_separada_por_virgula():
    s = _base(destinatarios="a@x.com, b@y.com ,")
    assert s.destinatarios == ["a@x.com", "b@y.com"]


def test_conta_formatada():
    s = _base(agencia="1234", conta="56789", conta_digito="0")
    assert s.conta_formatada == "1234/56789-0"

    s_sem_digito = _base(agencia="1234", conta="56789")
    assert s_sem_digito.conta_formatada == "1234/56789"


def test_validar_aponta_certificado_ausente():
    problemas = _base(cert_path="nao/existe.crt", key_path="nao/existe.key").validar()
    assert any("certificado nao encontrado" in p for p in problemas)
    assert any("chave privada nao encontrada" in p for p in problemas)


def test_validar_sem_credencial(tmp_path):
    cert = tmp_path / "c.crt"
    cert.write_text("x")
    key = tmp_path / "k.key"
    key.write_text("x")

    problemas = _base(client_id="", client_secret="", cert_path=cert, key_path=key).validar()
    assert "EXTRATO_CLIENT_ID nao definido" in problemas
    assert "EXTRATO_CLIENT_SECRET nao definido" in problemas


def test_validar_extrato_exige_conta(tmp_path):
    cert = tmp_path / "c.crt"
    cert.write_text("x")
    key = tmp_path / "k.key"
    key.write_text("x")

    problemas = _base(cert_path=cert, key_path=key).validar(exigir_extrato=True)
    assert "EXTRATO_AGENCIA nao definida" in problemas
    assert "EXTRATO_CONTA nao definida" in problemas
    # o path do extrato ja vem do manual, entao nao deve ser cobrado do usuario
    assert not any("EXTRATO_STATEMENT_PATH" in p for p in problemas)


def test_validar_email_exige_smtp(tmp_path):
    cert = tmp_path / "c.crt"
    cert.write_text("x")
    key = tmp_path / "k.key"
    key.write_text("x")

    problemas = _base(cert_path=cert, key_path=key).validar(exigir_email=True)
    assert "EXTRATO_SMTP_HOST nao definido" in problemas
    assert "EXTRATO_DESTINATARIOS vazio" in problemas


def test_segredos_nao_aparecem_no_repr():
    s = _base(client_secret="super-secreto", smtp_password="senha-secreta")
    texto = repr(s)
    assert "super-secreto" not in texto
    assert "senha-secreta" not in texto


def test_hosts_sao_derivados_do_ambiente():
    sandbox = Settings(_env_file=None, env="sandbox")
    assert sandbox.token_url == (
        "https://openapisandbox.prebanco.com.br/auth/server-mtls/v2/token"
    )
    assert sandbox.statement_url == (
        "https://openapisandbox.prebanco.com.br/v1/fornecimento-extratos-contas/extratos"
    )

    prod = Settings(_env_file=None, env="prod")
    assert prod.token_url == "https://openapi.bradesco.com.br/auth/server-mtls/v2/token"
    assert prod.balance_url == (
        "https://openapi.bradesco.com.br/v1/fornecimento-saldos-contas/saldos"
    )


def test_host_explicito_prevalece_sobre_o_derivado():
    s = Settings(_env_file=None, env="sandbox", token_url="https://outro.host/token")
    assert s.token_url == "https://outro.host/token"


def test_diretorios_sao_separados_por_ambiente():
    sandbox = _base(env="sandbox")
    prod = _base(env="prod")
    assert sandbox.data_dir != prod.data_dir
    assert sandbox.out_dir != prod.out_dir
