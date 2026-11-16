"""Envio por e-mail (SMTP) com o PDF em anexo."""

from __future__ import annotations

import logging
import mimetypes
import smtplib
from email.message import EmailMessage
from pathlib import Path

from ..config import Settings
from .base import ResultadoEnvio

log = logging.getLogger(__name__)


class EmailNotifier:
    canal = "email"

    def __init__(self, settings: Settings) -> None:
        self._s = settings

    def enviar(
        self,
        *,
        assunto: str,
        corpo: str,
        destinatarios: list[str],
        anexos: list[Path] | None = None,
    ) -> list[ResultadoEnvio]:
        if not destinatarios:
            return []

        remetente = self._s.smtp_from or self._s.smtp_user
        anexos = anexos or []

        try:
            with self._abrir_conexao() as smtp:
                # Uma conexao para todos, mas um envio por destinatario: assim a
                # recusa de um endereco nao derruba os outros, e cada um fica com
                # o seu proprio status no banco.
                return [
                    self._enviar_um(smtp, remetente, dest, assunto, corpo, anexos)
                    for dest in destinatarios
                ]
        except (OSError, smtplib.SMTPException) as exc:
            # Falha de conexao/login atinge todo mundo igualmente.
            erro = f"falha na conexao SMTP: {exc}"
            log.error(erro)
            return [ResultadoEnvio(dest, False, erro) for dest in destinatarios]

    # ------------------------------------------------------------------ interno
    def _abrir_conexao(self) -> smtplib.SMTP:
        smtp = smtplib.SMTP(self._s.smtp_host, self._s.smtp_port, timeout=self._s.http_timeout)
        smtp.ehlo()
        if smtp.has_extn("starttls"):
            smtp.starttls()
            smtp.ehlo()
        if self._s.smtp_user:
            smtp.login(self._s.smtp_user, self._s.smtp_password.get_secret_value())
        return smtp

    def _enviar_um(
        self,
        smtp: smtplib.SMTP,
        remetente: str,
        destinatario: str,
        assunto: str,
        corpo: str,
        anexos: list[Path],
    ) -> ResultadoEnvio:
        try:
            msg = EmailMessage()
            msg["From"] = remetente
            msg["To"] = destinatario
            msg["Subject"] = assunto
            msg.set_content(corpo)

            for caminho in anexos:
                tipo, _ = mimetypes.guess_type(caminho.name)
                maintype, _, subtype = (tipo or "application/octet-stream").partition("/")
                msg.add_attachment(
                    caminho.read_bytes(),
                    maintype=maintype,
                    subtype=subtype,
                    filename=caminho.name,
                )

            smtp.send_message(msg)
            log.info("e-mail enviado para %s", destinatario)
            return ResultadoEnvio(destinatario, True)
        except (OSError, smtplib.SMTPException) as exc:
            log.error("falha ao enviar para %s: %s", destinatario, exc)
            return ResultadoEnvio(destinatario, False, str(exc))
