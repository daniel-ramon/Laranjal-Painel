# -*- coding: utf-8 -*-
"""Gera a folha de separação (PDF) reutilizando o gerar_separacao.py do
projeto pedidos-automacao — mesmo formato já usado no galpão.

Uso:
  python folha_separacao.py --data 2026-11-12 --saida saida.pdf            (todos)
  python folha_separacao.py --data 2026-11-12 --rota 01 --saida saida.pdf  (só a rota)

Aplica as mesmas exclusões do script original (nosso, não duplicado, fornecedor
aceito) e filtra por data de ENTREGA. Com --rota, mantém só as lojas daquela
rota (lojas.csv) — a última página "TOTAL DO DIA" vira a carga do caminhão.
Imprime 'OK' no stdout quando gera, 'VAZIO' quando não há pedido.
"""
import sys
import os
import json
import argparse
from pathlib import Path

# Pasta do projeto pedidos-automacao. Vem de PEDIDOS_DIR (definido pelo Node a
# partir do config/.env); cai no caminho padrão só quando a env não existe.
# Hard-codar o caminho quebrava no servidor, onde o painel fica noutra pasta.
_env = (os.environ.get('PEDIDOS_DIR') or '').strip()
PROJ = Path(_env) if _env else Path(r'D:\LARANJAL\pedidos-automacao')

if not PROJ.exists():
    sys.stderr.write(
        'Pasta do projeto de pedidos nao encontrada: ' + str(PROJ) + '\n'
        'Defina PEDIDOS_DIR no .env do painel apontando para o pedidos-automacao.\n')
    sys.exit(2)

sys.path.insert(0, str(PROJ))

try:
    import gerar_separacao as gs          # noqa: E402
    import lojas as cadastro             # noqa: E402
    from modelos import Pedido, pedido_e_nosso  # noqa: E402
except ModuleNotFoundError as e:
    sys.stderr.write(
        'Nao foi possivel importar os modulos de ' + str(PROJ) + ': ' + str(e) + '\n'
        'Confirme que PEDIDOS_DIR aponta para a pasta do pedidos-automacao.\n')
    sys.exit(2)


def norm_rota(v):
    return str(v or '').strip().lstrip('0')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', required=True, help='data de entrega YYYY-MM-DD')
    ap.add_argument('--rota', default=None, help='filtra só esta rota (opcional)')
    ap.add_argument('--saida', required=True)
    a = ap.parse_args()

    dados = json.loads((PROJ / 'saida' / 'pedidos_extraidos.json').read_text(encoding='utf-8'))
    # mesmas exclusões do gerar_separacao.main(): nosso, não duplicado, fornecedor aceito
    nossos = [r for r in dados.get('pedidos', [])
              if r.get('nosso') and not r.get('duplicado')
              and pedido_e_nosso(Pedido(**r['pedido']))]
    nossos = [r for r in nossos if r.get('data_entrega') == a.data]

    rotulo_rota = ''
    if a.rota:
        alvo = norm_rota(a.rota)

        def na_rota(r):
            ped = Pedido(**r['pedido'])
            centro = ped.centro or r.get('loja_sugerida')
            loja = cadastro.achar(centro, r.get('centro_sugerido'))
            return loja is not None and norm_rota(loja.rota) == alvo

        nossos = [r for r in nossos if na_rota(r)]
        rotulo_rota = f' — Rota {a.rota}'

    if not nossos:
        print('VAZIO')
        return

    y, m, d = a.data.split('-')
    gs.gerar(nossos, Path(a.saida), f'entrega {d}/{m}/{y}{rotulo_rota}')
    print('OK')


if __name__ == '__main__':
    main()
