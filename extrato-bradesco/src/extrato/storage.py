"""Persistencia em SQLite: lancamentos, execucoes e envios.

Serve a dois propositos:

  1. **Idempotencia** — a API devolve o extrato inteiro a cada chamada, entao
     rodar duas vezes o mesmo dia traria os mesmos lancamentos. Cada lancamento
     recebe uma chave natural estavel e a tabela recusa duplicatas.
  2. **Historico** — permite reprocessar um dia, comparar periodos e saber o que
     ja foi enviado para quem.

Valores monetarios sao gravados como TEXT para preservar a precisao do Decimal;
REAL introduziria erro de ponto flutuante em dado financeiro.
"""

from __future__ import annotations

import hashlib
import logging
import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from .models import Extrato, Lancamento, Secao

log = logging.getLogger(__name__)

STATUS_OK = "sucesso"
STATUS_ERRO = "erro"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS lancamento (
    id           INTEGER PRIMARY KEY,
    chave        TEXT    NOT NULL UNIQUE,
    conta        TEXT    NOT NULL,
    data         TEXT,
    descricao    TEXT    NOT NULL DEFAULT '',
    complemento  TEXT    NOT NULL DEFAULT '',
    documento    TEXT    NOT NULL DEFAULT '',
    codigo       TEXT    NOT NULL DEFAULT '',
    valor        TEXT    NOT NULL,
    saldo_apos   TEXT,
    secao        TEXT    NOT NULL,
    criado_em    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lancamento_conta_data ON lancamento (conta, data);

CREATE TABLE IF NOT EXISTS execucao (
    id            INTEGER PRIMARY KEY,
    conta         TEXT NOT NULL,
    data_inicio   TEXT NOT NULL,
    data_fim      TEXT NOT NULL,
    status        TEXT NOT NULL,
    novos         INTEGER NOT NULL DEFAULT 0,
    total         INTEGER NOT NULL DEFAULT 0,
    pdf           TEXT,
    mensagem      TEXT,
    iniciado_em   TEXT NOT NULL,
    finalizado_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_execucao_periodo
    ON execucao (conta, data_inicio, data_fim, status);

CREATE TABLE IF NOT EXISTS envio (
    id           INTEGER PRIMARY KEY,
    execucao_id  INTEGER NOT NULL REFERENCES execucao (id),
    canal        TEXT NOT NULL,
    destinatario TEXT NOT NULL,
    status       TEXT NOT NULL,
    erro         TEXT,
    enviado_em   TEXT NOT NULL
);
"""


def chave_lancamento(conta: str, lanc: Lancamento, ordinal: int = 0) -> str:
    """Chave natural estavel de um lancamento.

    O banco nao expoe um id proprio, entao a identidade e derivada do conteudo.
    `ordinal` desempata lancamentos genuinamente identicos no mesmo dia (mesmo
    valor, mesmo documento, mesma descricao) — que existem, por exemplo, em duas
    tarifas iguais cobradas na mesma data.
    """
    partes = [
        conta,
        lanc.data.isoformat() if lanc.data else "",
        lanc.documento,
        lanc.codigo,
        str(lanc.valor),
        lanc.descricao,
        lanc.complemento,
        str(ordinal),
    ]
    return hashlib.sha256("|".join(partes).encode("utf-8")).hexdigest()


class Storage:
    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conectar() as con:
            con.executescript(_SCHEMA)

    @contextmanager
    def _conectar(self) -> Iterator[sqlite3.Connection]:
        con = sqlite3.connect(self._db_path)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys = ON")
        try:
            yield con
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()

    # ------------------------------------------------------------ lancamentos
    def gravar_lancamentos(self, conta: str, lancamentos: Iterable[Lancamento]) -> int:
        """Grava os lancamentos ainda desconhecidos. Devolve quantos eram novos."""
        vistos: dict[str, int] = {}
        linhas = []
        agora = datetime.now().isoformat(timespec="seconds")

        for lanc in lancamentos:
            # Conta quantas vezes este conteudo ja apareceu nesta remessa, para
            # que duplicatas legitimas recebam ordinais diferentes.
            base = chave_lancamento(conta, lanc, 0)
            ordinal = vistos.get(base, 0)
            vistos[base] = ordinal + 1

            linhas.append(
                (
                    chave_lancamento(conta, lanc, ordinal),
                    conta,
                    lanc.data.isoformat() if lanc.data else None,
                    lanc.descricao,
                    lanc.complemento,
                    lanc.documento,
                    lanc.codigo,
                    str(lanc.valor),
                    str(lanc.saldo_apos) if lanc.saldo_apos is not None else None,
                    str(lanc.secao),
                    agora,
                )
            )

        if not linhas:
            return 0

        with self._conectar() as con:
            antes = con.execute("SELECT COUNT(*) FROM lancamento").fetchone()[0]
            con.executemany(
                """
                INSERT OR IGNORE INTO lancamento
                    (chave, conta, data, descricao, complemento, documento, codigo,
                     valor, saldo_apos, secao, criado_em)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                linhas,
            )
            depois = con.execute("SELECT COUNT(*) FROM lancamento").fetchone()[0]

        novos = depois - antes
        log.info("%s lancamentos recebidos, %s novos gravados", len(linhas), novos)
        return novos

    def lancamentos_do_periodo(
        self, conta: str, data_inicio: date, data_fim: date
    ) -> list[Lancamento]:
        """Le do banco local, sem tocar na API — usado para reprocessar um dia."""
        with self._conectar() as con:
            linhas = con.execute(
                """
                SELECT * FROM lancamento
                 WHERE conta = ? AND data BETWEEN ? AND ?
                 ORDER BY data, id
                """,
                (conta, data_inicio.isoformat(), data_fim.isoformat()),
            ).fetchall()

        return [
            Lancamento(
                data=date.fromisoformat(linha["data"]) if linha["data"] else None,
                descricao=linha["descricao"],
                complemento=linha["complemento"],
                documento=linha["documento"],
                codigo=linha["codigo"],
                valor=Decimal(linha["valor"]),
                saldo_apos=Decimal(linha["saldo_apos"]) if linha["saldo_apos"] else None,
                secao=Secao(linha["secao"]),
            )
            for linha in linhas
        ]

    # -------------------------------------------------------------- execucoes
    def ja_processado(self, conta: str, data_inicio: date, data_fim: date) -> bool:
        """Houve execucao bem-sucedida para exatamente este periodo?"""
        with self._conectar() as con:
            linha = con.execute(
                """
                SELECT 1 FROM execucao
                 WHERE conta = ? AND data_inicio = ? AND data_fim = ? AND status = ?
                 LIMIT 1
                """,
                (conta, data_inicio.isoformat(), data_fim.isoformat(), STATUS_OK),
            ).fetchone()
        return linha is not None

    def abrir_execucao(self, conta: str, data_inicio: date, data_fim: date) -> int:
        with self._conectar() as con:
            cur = con.execute(
                """
                INSERT INTO execucao
                    (conta, data_inicio, data_fim, status, iniciado_em)
                VALUES (?, ?, ?, 'em_andamento', ?)
                """,
                (
                    conta,
                    data_inicio.isoformat(),
                    data_fim.isoformat(),
                    datetime.now().isoformat(timespec="seconds"),
                ),
            )
        return int(cur.lastrowid)

    def fechar_execucao(
        self,
        execucao_id: int,
        *,
        status: str,
        novos: int = 0,
        total: int = 0,
        pdf: Path | None = None,
        mensagem: str | None = None,
    ) -> None:
        with self._conectar() as con:
            con.execute(
                """
                UPDATE execucao
                   SET status = ?, novos = ?, total = ?, pdf = ?, mensagem = ?,
                       finalizado_em = ?
                 WHERE id = ?
                """,
                (
                    status,
                    novos,
                    total,
                    str(pdf) if pdf else None,
                    mensagem,
                    datetime.now().isoformat(timespec="seconds"),
                    execucao_id,
                ),
            )

    # ------------------------------------------------------------------ envios
    def registrar_envio(
        self,
        execucao_id: int,
        *,
        canal: str,
        destinatario: str,
        status: str,
        erro: str | None = None,
    ) -> None:
        with self._conectar() as con:
            con.execute(
                """
                INSERT INTO envio
                    (execucao_id, canal, destinatario, status, erro, enviado_em)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    execucao_id,
                    canal,
                    destinatario,
                    status,
                    erro,
                    datetime.now().isoformat(timespec="seconds"),
                ),
            )


def resumo_novos(storage: Storage, conta: str, extrato: Extrato) -> int:
    """Grava os lancamentos realizados do extrato e devolve quantos eram novos.

    Lancamentos futuros nao sao persistidos: eles mudam de status ate se
    realizarem, e gravar cada previsao poluiria o historico.
    """
    return storage.gravar_lancamentos(conta, extrato.lancamentos)
