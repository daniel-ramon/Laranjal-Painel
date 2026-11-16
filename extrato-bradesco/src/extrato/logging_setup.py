"""Configuracao de log: console + arquivo rotativo em logs/."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path

_FORMATO = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"
_configurado = False


def configurar_log(logs_dir: Path, level: str = "INFO") -> None:
    """Idempotente — chamar no inicio de cada comando da CLI."""
    global _configurado
    if _configurado:
        return

    logs_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(_FORMATO)

    console = logging.StreamHandler()
    console.setFormatter(formatter)

    arquivo = RotatingFileHandler(
        logs_dir / "extrato.log",
        maxBytes=2_000_000,
        backupCount=10,
        encoding="utf-8",
    )
    arquivo.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(level.upper())
    root.handlers[:] = [console, arquivo]

    # httpx loga a URL completa de cada request em INFO; em DEBUG chega a logar
    # headers. Mantemos em WARNING para nao vazar token nem query com dados da conta.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    _configurado = True
