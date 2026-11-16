"""Ponte entre o painel (Node) e o projeto de Extrato Bradesco.

Consulta o extrato (ou usa um payload salvo) e emite o resultado como JSON em
stdout, no formato que a pagina consome. Erros saem como {"ok": false, "erro": ...}
com codigo de saida 1 — a senha/credencial nunca aparece na saida.

Uso:
  python extrato_bradesco.py --data-inicio 2024-11-06 --data-fim 2024-11-20
  python extrato_bradesco.py --payload caminho/resposta.json --data-inicio ... --data-fim ...
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

# O projeto copiado para dentro do painel.
RAIZ_EXTRATO = Path(__file__).resolve().parents[1] / "extrato-bradesco"
sys.path.insert(0, str(RAIZ_EXTRATO / "src"))


def _data(texto: str) -> date:
    return datetime.strptime(texto, "%Y-%m-%d").date()


def _f(v: Decimal | None) -> float | None:
    return None if v is None else float(v)


def _lanc(l) -> dict:
    return {
        "data": l.data.isoformat() if l.data else None,
        "descricao": l.descricao,
        "complemento": l.complemento,
        "documento": l.documento,
        "codigo": l.codigo,
        "valor": _f(l.valor),
        "saldo_apos": _f(l.saldo_apos),
        "secao": l.secao.value,
        "credito": l.credito,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-inicio", required=True)
    ap.add_argument("--data-fim", required=True)
    ap.add_argument("--payload", default=None, help="Usa uma resposta salva em vez da API.")
    args = ap.parse_args()

    try:
        inicio = _data(args.data_inicio)
        fim = _data(args.data_fim)
    except ValueError:
        print(json.dumps({"ok": False, "erro": "data invalida (use AAAA-MM-DD)"}))
        return 1

    from extrato.config import get_settings
    from extrato.models import parse_extrato, parse_saldos

    settings = get_settings()

    # Cheque especial disponivel (produto "LIMITE A UTILIZAR" da API de Saldo).
    # So existe no modo API; no demo (payload do extrato) fica None.
    cheque_especial_disponivel = None

    try:
        if args.payload:
            bruto = json.load(open(args.payload, encoding="utf-8"))
            extrato = parse_extrato(bruto, agencia=settings.agencia, data_inicio=inicio, data_fim=fim)
        else:
            problemas = settings.validar(exigir_extrato=True)
            if problemas:
                print(json.dumps({"ok": False, "erro": "configuracao incompleta: " + "; ".join(problemas)}))
                return 1
            from extrato.auth import AuthError, criar_http_client
            from extrato.bradesco import ClienteBradesco, ExtratoHTTPError
            from extrato.models import ExtratoAPIError
            try:
                with criar_http_client(settings) as client:
                    cli = ClienteBradesco(settings, client)
                    extrato = cli.consultar_extrato(inicio, fim)
                    # Saldo e complementar: traz o cheque especial. Reaproveita o
                    # mesmo token (cache); se falhar, nao derruba o extrato.
                    try:
                        saldos = parse_saldos(cli.consultar_saldo())
                        cheque_especial_disponivel = saldos.get("LIMITE A UTILIZAR")
                    except Exception:  # noqa: BLE001
                        cheque_especial_disponivel = None
            except (AuthError, ExtratoHTTPError, ExtratoAPIError) as exc:
                print(json.dumps({"ok": False, "erro": str(exc)[:400]}))
                return 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "erro": f"{type(exc).__name__}: {str(exc)[:300]}"}))
        return 1

    saida = {
        "ok": True,
        "modo": settings.env,
        "conta": {
            "agencia": extrato.conta.agencia,
            "numero": extrato.conta.numero,
            "digito": extrato.conta.digito,
            "formatada": str(extrato.conta),
            "razao": extrato.conta.razao,
            "nome_cliente": extrato.conta.nome_cliente.strip(),
        },
        "periodo": {"inicio": inicio.isoformat(), "fim": fim.isoformat()},
        "saldo_anterior": _f(extrato.saldo_anterior),
        "data_saldo_anterior": extrato.data_saldo_anterior.isoformat() if extrato.data_saldo_anterior else None,
        "creditos": _f(extrato.creditos),
        "debitos": _f(extrato.debitos),
        "saldo_final": _f(extrato.saldo_final),
        "cheque_especial_disponivel": _f(cheque_especial_disponivel),
        "lancamentos": [_lanc(l) for l in extrato.lancamentos],
        "futuros": [_lanc(l) for l in extrato.futuros],
        "mensagens": extrato.mensagens,
        "totais": {"qtd": len(extrato.lancamentos), "qtd_futuros": len(extrato.futuros)},
    }
    print(json.dumps(saida, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
