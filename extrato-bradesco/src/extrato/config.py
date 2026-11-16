"""Configuracao do projeto, carregada de variaveis de ambiente / arquivo .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]

# Manual do Desenvolvedor "mTLS" v1.0.0
HOSTS = {
    "sandbox": "https://openapisandbox.prebanco.com.br",
    "prod": "https://openapi.bradesco.com.br",
}
TOKEN_PATH = "/auth/server-mtls/v2/token"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_prefix="EXTRATO_",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["sandbox", "prod"] = "sandbox"

    # credenciais
    client_id: str = ""
    client_secret: SecretStr = SecretStr("")

    # certificados
    cert_path: Path = Path("certs/certificado.crt")
    key_path: Path = Path("certs/chave.key")

    # API — hosts e paths conforme o Manual API de Saldo e Extrato v2.2.1
    token_url: str = ""
    api_base_url: str = ""
    statement_path: str = "/v1/fornecimento-extratos-contas/extratos"
    balance_path: str = "/v1/fornecimento-saldos-contas/saldos"
    http_timeout: float = 30.0

    # conta — agencia e conta vao SEM digito na chamada da API
    agencia: str = ""
    conta: str = ""
    conta_digito: str = ""
    # tipo de conta: cc (corrente) ou cp (poupanca)
    tipo_conta: Literal["cc", "cp"] = "cc"
    # 1 = saldo do dia (so conta corrente); 2 = unificado com Invest Facil
    tipo_operacao: int = 1

    # e-mail
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = ""
    # NoDecode: sem ele, pydantic-settings tenta json.loads no valor cru da env
    # var antes do validador abaixo rodar, e uma lista separada por virgula quebra.
    destinatarios: Annotated[list[str], NoDecode] = Field(default_factory=list)

    # operacao
    retencao_pdf_dias: int = 90
    log_level: str = "INFO"

    @field_validator("destinatarios", mode="before")
    @classmethod
    def _split_destinatarios(cls, v: object) -> object:
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    @field_validator("cert_path", "key_path")
    @classmethod
    def _absolutize(cls, v: Path) -> Path:
        return v if v.is_absolute() else (PROJECT_ROOT / v)

    @model_validator(mode="after")
    def _preencher_hosts(self) -> Settings:
        """Deriva os hosts do ambiente quando nao informados explicitamente."""
        base = HOSTS[self.env]
        if not self.api_base_url:
            object.__setattr__(self, "api_base_url", base)
        if not self.token_url:
            object.__setattr__(self, "token_url", f"{base}{TOKEN_PATH}")
        return self

    # ------------------------------------------------------------- derivados
    @property
    def statement_url(self) -> str:
        return f"{self.api_base_url.rstrip('/')}{self.statement_path}"

    @property
    def balance_url(self) -> str:
        return f"{self.api_base_url.rstrip('/')}{self.balance_path}"

    @property
    def conta_formatada(self) -> str:
        """Ex.: 1234/56789-0 — apenas para exibicao em log e relatorio."""
        if not self.agencia and not self.conta:
            return ""
        digito = f"-{self.conta_digito}" if self.conta_digito else ""
        return f"{self.agencia}/{self.conta}{digito}"

    @property
    def data_dir(self) -> Path:
        return PROJECT_ROOT / "data" / self.env

    @property
    def out_dir(self) -> Path:
        return PROJECT_ROOT / "out" / self.env

    @property
    def logs_dir(self) -> Path:
        return PROJECT_ROOT / "logs"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "extrato.db"

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.out_dir, self.logs_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------- validacao
    def validar(self, *, exigir_extrato: bool = False, exigir_email: bool = False) -> list[str]:
        """Devolve a lista de problemas encontrados. Lista vazia = tudo certo.

        Nao levanta excecao: o chamador decide como reportar. Os campos sao
        checados em grupos porque nem todo comando precisa de tudo (gerar um PDF
        a partir do banco local, por exemplo, nao precisa de credencial).
        """
        problemas: list[str] = []

        if not self.client_id:
            problemas.append("EXTRATO_CLIENT_ID nao definido")
        if not self.client_secret.get_secret_value():
            problemas.append("EXTRATO_CLIENT_SECRET nao definido")

        if not self.cert_path.is_file():
            problemas.append(f"certificado nao encontrado em {self.cert_path}")
        if not self.key_path.is_file():
            problemas.append(f"chave privada nao encontrada em {self.key_path}")

        if not self.token_url:
            problemas.append("EXTRATO_TOKEN_URL nao definido")

        if exigir_extrato:
            if not self.statement_path:
                problemas.append("EXTRATO_STATEMENT_PATH nao definido")
            if not self.agencia:
                problemas.append("EXTRATO_AGENCIA nao definida")
            if not self.conta:
                problemas.append("EXTRATO_CONTA nao definida")

        if exigir_email:
            if not self.smtp_host:
                problemas.append("EXTRATO_SMTP_HOST nao definido")
            if not self.smtp_user:
                problemas.append("EXTRATO_SMTP_USER nao definido")
            if not self.smtp_password.get_secret_value():
                problemas.append("EXTRATO_SMTP_PASSWORD nao definida")
            if not self.destinatarios:
                problemas.append("EXTRATO_DESTINATARIOS vazio")

        return problemas


class ConfigInvalidaError(RuntimeError):
    def __init__(self, problemas: list[str]) -> None:
        self.problemas = problemas
        super().__init__("configuracao invalida:\n  - " + "\n  - ".join(problemas))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
