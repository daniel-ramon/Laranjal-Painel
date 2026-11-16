"""Teste de integracao do comando `diario`, com API e SMTP simulados.

O sandbox do Bradesco e um stub que so responde ao conjunto exato de parametros
do manual (agencia 3750, conta 75557, 06/11/2024 a 20/11/2024) — qualquer outra
data devolve 404 "Erro de estrutura". Por isso a orquestracao e verificada aqui,
offline, e nao contra o ambiente do banco.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import httpx
import pytest
import respx
from typer.testing import CliRunner

from extrato.config import Settings
from extrato.main import app
from extrato.storage import STATUS_ERRO, STATUS_OK, Storage

TOKEN_URL = "https://exemplo.invalido/auth/server-mtls/v2/token"
EXTRATO_URL = "https://exemplo.invalido/v1/fornecimento-extratos-contas/extratos"
FIXTURE = Path(__file__).parent / "fixtures" / "extrato_sandbox.json"

runner = CliRunner()


class SettingsDeTeste(Settings):
    """Redireciona data/out/logs para o tmp_path do teste."""

    raiz_teste: Path = Path(".")

    @property
    def data_dir(self) -> Path:
        return self.raiz_teste / "data"

    @property
    def out_dir(self) -> Path:
        return self.raiz_teste / "out"

    @property
    def logs_dir(self) -> Path:
        return self.raiz_teste / "logs"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "extrato.db"


class SMTPFalso:
    enviadas: list = []
    falhar = False

    def __init__(self, *_a, **_k):
        if SMTPFalso.falhar:
            raise OSError("conexao recusada")

    def ehlo(self):
        return None

    def has_extn(self, _n):
        return False

    def login(self, *_a):
        return None

    def send_message(self, msg):
        SMTPFalso.enviadas.append(msg)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture(autouse=True)
def ambiente(tmp_path, monkeypatch):
    SMTPFalso.enviadas = []
    SMTPFalso.falhar = False
    monkeypatch.setattr("extrato.notify.email.smtplib.SMTP", SMTPFalso)

    cert = tmp_path / "c.crt"
    cert.write_text("x")
    key = tmp_path / "k.key"
    key.write_text("x")

    settings = SettingsDeTeste(
        _env_file=None,
        raiz_teste=tmp_path,
        client_id="cid",
        client_secret="csec",
        cert_path=cert,
        key_path=key,
        token_url=TOKEN_URL,
        api_base_url="https://exemplo.invalido",
        agencia="3750",
        conta="75557",
        smtp_host="smtp.exemplo.invalido",
        smtp_user="rotina@exemplo.com",
        smtp_password="senha",
        smtp_from="rotina@exemplo.com",
        destinatarios="a@x.com,b@x.com",
    )
    monkeypatch.setattr("extrato.main.get_settings", lambda: settings)
    # o mTLS real nao existe no teste; o respx intercepta antes do handshake
    monkeypatch.setattr("extrato.main.criar_http_client", lambda _s: httpx.Client())
    return settings


def _mockar_api(payload: dict | None = None, status: int = 200) -> None:
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
    )
    if status == 200:
        corpo = payload if payload is not None else json.loads(FIXTURE.read_text("utf-8"))
        respx.get(EXTRATO_URL).mock(return_value=httpx.Response(200, json=corpo))
    else:
        respx.get(EXTRATO_URL).mock(return_value=httpx.Response(status, text="indisponivel"))


@respx.mock
def test_pipeline_completo_gera_pdf_e_envia(ambiente):
    _mockar_api()

    r = runner.invoke(app, ["diario", "--data", "2024-11-20"])

    assert r.exit_code == 0, r.output
    pdfs = list(ambiente.out_dir.glob("*.pdf"))
    assert len(pdfs) == 1
    assert pdfs[0].read_bytes().startswith(b"%PDF")

    assert len(SMTPFalso.enviadas) == 2
    msg = SMTPFalso.enviadas[0]
    assert "20/11/2024" in msg["Subject"]
    assert "3750/75557" in msg["Subject"]
    anexos = list(msg.iter_attachments())
    assert anexos[0].get_content_type() == "application/pdf"


@respx.mock
def test_segunda_execucao_do_mesmo_dia_nao_reenvia(ambiente):
    _mockar_api()

    assert runner.invoke(app, ["diario", "--data", "2024-11-20"]).exit_code == 0
    assert len(SMTPFalso.enviadas) == 2

    segunda = runner.invoke(app, ["diario", "--data", "2024-11-20"])

    assert segunda.exit_code == 0
    assert "ja foi processado" in segunda.output
    assert len(SMTPFalso.enviadas) == 2  # nada foi reenviado


@respx.mock
def test_forcar_reprocessa_sem_duplicar_lancamentos(ambiente):
    _mockar_api()

    runner.invoke(app, ["diario", "--data", "2024-11-20"])
    storage = Storage(ambiente.db_path)
    total = len(storage.lancamentos_do_periodo("75557", date(2024, 1, 1), date(2025, 12, 31)))

    r = runner.invoke(app, ["diario", "--data", "2024-11-20", "--forcar"])

    assert r.exit_code == 0
    assert len(SMTPFalso.enviadas) == 4  # reenviou
    depois = len(storage.lancamentos_do_periodo("75557", date(2024, 1, 1), date(2025, 12, 31)))
    assert depois == total  # mas nao duplicou nada


@respx.mock
def test_dry_run_gera_pdf_mas_nao_envia(ambiente):
    _mockar_api()

    r = runner.invoke(app, ["diario", "--data", "2024-11-20", "--dry-run"])

    assert r.exit_code == 0
    assert list(ambiente.out_dir.glob("*.pdf"))
    assert SMTPFalso.enviadas == []
    assert "dry-run" in r.output
    assert "Saldo final" in r.output or "saldo final" in r.output.lower()


@respx.mock
def test_dry_run_nao_bloqueia_o_envio_posterior(ambiente):
    _mockar_api()

    runner.invoke(app, ["diario", "--data", "2024-11-20", "--dry-run"])
    # o dry-run fecha a execucao como sucesso, entao o envio real precisa de --forcar
    r = runner.invoke(app, ["diario", "--data", "2024-11-20", "--forcar"])

    assert r.exit_code == 0
    assert len(SMTPFalso.enviadas) == 2


@respx.mock
def test_falha_na_api_registra_erro_e_alerta(ambiente):
    _mockar_api(status=503)

    r = runner.invoke(app, ["diario", "--data", "2024-11-20"])

    assert r.exit_code == 1
    # o alerta de falha vai pelos mesmos destinatarios
    assert len(SMTPFalso.enviadas) == 2
    assert all("[FALHA]" in m["Subject"] for m in SMTPFalso.enviadas)
    # e sem stacktrace no corpo
    assert "Traceback" not in SMTPFalso.enviadas[0].get_content()

    storage = Storage(ambiente.db_path)
    assert not storage.ja_processado("75557", date(2024, 11, 20), date(2024, 11, 20))


@respx.mock
def test_falha_no_envio_marca_execucao_como_erro(ambiente):
    _mockar_api()
    SMTPFalso.falhar = True

    r = runner.invoke(app, ["diario", "--data", "2024-11-20"])

    assert r.exit_code == 1
    storage = Storage(ambiente.db_path)
    # o dia nao pode contar como concluido se ninguem recebeu
    assert not storage.ja_processado("75557", date(2024, 11, 20), date(2024, 11, 20))

    with storage._conectar() as con:  # noqa: SLF001 - inspecao de teste
        envios = con.execute("SELECT status FROM envio").fetchall()
    assert [e["status"] for e in envios] == [STATUS_ERRO, STATUS_ERRO]


@respx.mock
def test_execucao_bem_sucedida_fica_registrada(ambiente):
    _mockar_api()

    runner.invoke(app, ["diario", "--data", "2024-11-20"])

    storage = Storage(ambiente.db_path)
    with storage._conectar() as con:  # noqa: SLF001 - inspecao de teste
        execucao = con.execute("SELECT * FROM execucao").fetchone()

    assert execucao["status"] == STATUS_OK
    assert execucao["total"] == 18
    assert execucao["novos"] == 18
    assert execucao["pdf"].endswith(".pdf")
    assert execucao["finalizado_em"]
