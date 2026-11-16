"""Testes do envio por e-mail, com SMTP simulado."""

from __future__ import annotations

import smtplib
from pathlib import Path

import pytest

from extrato.config import Settings
from extrato.notify import EmailNotifier


class FakeSMTP:
    """Substituto de smtplib.SMTP que registra as mensagens enviadas."""

    instancia: "FakeSMTP | None" = None

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port
        self.enviadas = []
        self.logins = []
        self.starttls_chamado = False
        self.recusar = set()
        FakeSMTP.instancia = self

    def ehlo(self):
        return None

    def has_extn(self, _nome):
        return True

    def starttls(self):
        self.starttls_chamado = True

    def login(self, user, senha):
        self.logins.append((user, senha))

    def send_message(self, msg):
        if msg["To"] in self.recusar:
            raise smtplib.SMTPRecipientsRefused({msg["To"]: (550, b"nao existe")})
        self.enviadas.append(msg)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def quit(self):
        return None


@pytest.fixture
def settings(tmp_path) -> Settings:
    cert = tmp_path / "c.crt"
    cert.write_text("x")
    key = tmp_path / "k.key"
    key.write_text("x")
    return Settings(
        _env_file=None,
        cert_path=cert,
        key_path=key,
        smtp_host="smtp.exemplo.invalido",
        smtp_port=587,
        smtp_user="rotina@exemplo.com",
        smtp_password="senha-secreta",
        smtp_from="rotina@exemplo.com",
    )


@pytest.fixture
def fake_smtp(monkeypatch):
    monkeypatch.setattr("extrato.notify.email.smtplib.SMTP", FakeSMTP)
    yield
    FakeSMTP.instancia = None


@pytest.fixture
def pdf(tmp_path) -> Path:
    caminho = tmp_path / "extrato_3750-75557_2025-01-10.pdf"
    caminho.write_bytes(b"%PDF-1.4 conteudo")
    return caminho


def test_envia_para_todos_com_anexo(settings, fake_smtp, pdf):
    resultados = EmailNotifier(settings).enviar(
        assunto="Extrato 10/01/2025",
        corpo="resumo",
        destinatarios=["a@x.com", "b@x.com"],
        anexos=[pdf],
    )

    assert [r.sucesso for r in resultados] == [True, True]
    smtp = FakeSMTP.instancia
    assert len(smtp.enviadas) == 2
    assert smtp.starttls_chamado
    assert smtp.logins == [("rotina@exemplo.com", "senha-secreta")]

    msg = smtp.enviadas[0]
    assert msg["Subject"] == "Extrato 10/01/2025"
    assert msg["To"] == "a@x.com"
    anexos = [p for p in msg.iter_attachments()]
    assert len(anexos) == 1
    assert anexos[0].get_filename() == pdf.name
    assert anexos[0].get_content_type() == "application/pdf"
    assert anexos[0].get_payload(decode=True) == b"%PDF-1.4 conteudo"


def test_falha_em_um_destinatario_nao_aborta_os_demais(settings, fake_smtp, pdf):
    notifier = EmailNotifier(settings)

    # Prepara a recusa antes do envio, instanciando o fake pela conexao.
    class SMTPQueRecusa(FakeSMTP):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self.recusar = {"ruim@x.com"}

    import extrato.notify.email as mod

    mod.smtplib.SMTP = SMTPQueRecusa
    resultados = notifier.enviar(
        assunto="Extrato",
        corpo="resumo",
        destinatarios=["bom@x.com", "ruim@x.com", "outro@x.com"],
        anexos=[pdf],
    )
    mod.smtplib.SMTP = FakeSMTP

    assert [r.destinatario for r in resultados] == ["bom@x.com", "ruim@x.com", "outro@x.com"]
    assert [r.sucesso for r in resultados] == [True, False, True]
    assert "nao existe" in resultados[1].erro
    # os dois bons foram entregues mesmo com a recusa no meio
    assert len(FakeSMTP.instancia.enviadas) == 2


def test_falha_de_conexao_marca_todos_como_erro(settings, monkeypatch, pdf):
    def explode(*_a, **_k):
        raise OSError("conexao recusada")

    monkeypatch.setattr("extrato.notify.email.smtplib.SMTP", explode)

    resultados = EmailNotifier(settings).enviar(
        assunto="Extrato", corpo="resumo", destinatarios=["a@x.com", "b@x.com"], anexos=[pdf]
    )

    assert [r.sucesso for r in resultados] == [False, False]
    assert all("conexao recusada" in r.erro for r in resultados)


def test_sem_destinatarios_nao_abre_conexao(settings, monkeypatch):
    def explode(*_a, **_k):
        raise AssertionError("nao deveria conectar")

    monkeypatch.setattr("extrato.notify.email.smtplib.SMTP", explode)
    assert EmailNotifier(settings).enviar(
        assunto="x", corpo="y", destinatarios=[]
    ) == []


def test_envio_sem_anexo(settings, fake_smtp):
    resultados = EmailNotifier(settings).enviar(
        assunto="[FALHA] Extrato", corpo="a rotina falhou", destinatarios=["a@x.com"]
    )
    assert resultados[0].sucesso
    msg = FakeSMTP.instancia.enviadas[0]
    assert list(msg.iter_attachments()) == []
    assert "a rotina falhou" in msg.get_content()
