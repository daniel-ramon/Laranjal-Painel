"""Interface de notificacao.

Toda a orquestracao fala com `Notifier`, nunca com um canal concreto. Trocar
e-mail por WhatsApp (Fase 8) e acrescentar uma implementacao aqui dentro, sem
tocar em nada fora do pacote `notify`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class ResultadoEnvio:
    destinatario: str
    sucesso: bool
    erro: str | None = None


@runtime_checkable
class Notifier(Protocol):
    canal: str

    def enviar(
        self,
        *,
        assunto: str,
        corpo: str,
        destinatarios: list[str],
        anexos: list[Path] | None = None,
    ) -> list[ResultadoEnvio]:
        """Envia para todos os destinatarios.

        A falha de um destinatario nao pode abortar os demais: cada um recebe o
        seu proprio ResultadoEnvio, e o chamador decide o que fazer.
        """
        ...
