# -*- coding: utf-8 -*-
"""
Lê todos os arquivos .xlsx da pasta de adiantamentos (Relatório de antecipação
do Nordestão) e devolve JSON no stdout com o mapa NUMNOTA -> dados do adiantamento.

Uso: python read_adiantamentos.py "<pasta>"
Saída: {"ok":true,"min":<menor referencia>,"count":N,"arquivos":[...],"itens":{"<numnota>":{...}}}
"""
import sys, os, json, unicodedata

def norm(s):
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode('ascii')
    return s.strip().lower()

def to_iso(v):
    if v is None:
        return None
    try:
        # datetime/date do openpyxl
        return v.date().isoformat() if hasattr(v, 'date') else (v.isoformat() if hasattr(v, 'isoformat') else str(v)[:10])
    except Exception:
        return str(v)[:10]

def to_num(v):
    if v is None:
        return None
    try:
        return float(str(v).strip().replace(',', '.'))
    except Exception:
        return None

# header normalizado -> chave interna
COLMAP = {
    'referencia': 'ref',
    'referencia principal': 'refprinc',
    'tipo de documento': 'tipo',
    'montante': 'montante',
    'taxa': 'taxa',
    'data de pagamento': 'dataPagamento',
    'data de vencimento': 'dataVencimento',
    'dias': 'dias',
    'desconto': 'descontoArq',
    'valor liquido': 'valorLiquidoArq',
}

def parse_file(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    out = []
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        # acha a linha de cabeçalho (a que contém "referencia" e "montante")
        hdr_idx = None
        for i, r in enumerate(rows[:10]):
            vals = [norm(c) for c in r]
            # cabeçalho: tem 'Montante' e pelo menos uma das colunas de referência
            if 'montante' in vals and ('referencia' in vals or 'referencia principal' in vals):
                hdr_idx = i
                break
        if hdr_idx is None:
            continue
        hdr = rows[hdr_idx]
        idx = {}
        for ci, c in enumerate(hdr):
            key = COLMAP.get(norm(c))
            if key and key not in idx:
                idx[key] = ci
        if 'ref' not in idx and 'refprinc' not in idx:
            continue
        for r in rows[hdr_idx + 1:]:
            def g(k):
                return r[idx[k]] if (k in idx and idx[k] < len(r)) else None
            # Só os títulos de adiantamento (Tipo de documento = R1 / EF_Revenda).
            # As demais linhas (R7 "Devolução Avaria", VE, VJ, VZ e subtotais) NÃO
            # são títulos nossos e não podem influenciar o menor NUMNOTA.
            if 'tipo' in idx and norm(g('tipo')) != 'r1':
                continue
            # NUMNOTA: 1º tenta a coluna 'Referência'; se faltar/for inválida,
            # deriva de 'Referência Principal' (ex.: '000011163-1/A' -> 11163:
            # dígitos antes do '-', com os zeros à esquerda removidos).
            raw = g('ref')
            s = ('' if raw is None else str(raw)).strip()
            if s.endswith('.0'):
                s = s[:-2]
            nota = None
            if s.isdigit():
                nota = int(s)
            else:
                rp = g('refprinc')
                rp = ('' if rp is None else str(rp)).strip()
                head = ''.join(ch for ch in rp.split('-')[0] if ch.isdigit())
                if head:
                    nota = int(head)   # int() remove os zeros à esquerda
            if nota is None:
                continue
            montante = to_num(g('montante'))
            desc = to_num(g('descontoArq'))
            liq = to_num(g('valorLiquidoArq'))
            taxa = to_num(g('taxa'))
            dias = to_num(g('dias'))
            out.append({
                'numnota': nota,
                'montante': abs(montante) if montante is not None else None,
                'taxa': taxa,
                'dataPagamento': to_iso(g('dataPagamento')),
                'dataVencimento': to_iso(g('dataVencimento')),
                'dias': int(dias) if dias is not None else None,
                'descontoArq': abs(desc) if desc is not None else None,
                'valorLiquidoArq': abs(liq) if liq is not None else None,
            })
    return out

def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else '.'
    arquivos = []
    try:
        nomes = sorted(os.listdir(folder), key=lambda n: os.path.getmtime(os.path.join(folder, n)))
    except Exception as e:
        print(json.dumps({'ok': False, 'erro': 'pasta inacessível: ' + str(e), 'itens': {}, 'min': None, 'count': 0}))
        return
    itens = {}
    for nome in nomes:
        if nome.startswith('~$'):
            continue
        if not nome.lower().endswith('.xlsx'):
            continue
        full = os.path.join(folder, nome)
        try:
            registros = parse_file(full)
        except Exception as e:
            arquivos.append({'arquivo': nome, 'erro': str(e)})
            continue
        arquivos.append({'arquivo': nome, 'linhas': len(registros)})
        # arquivos já vêm ordenados por mtime asc -> o mais recente sobrescreve
        for reg in registros:
            itens[str(reg['numnota'])] = reg
    refs = [int(k) for k in itens.keys()]
    print(json.dumps({
        'ok': True,
        'min': min(refs) if refs else None,
        'max': max(refs) if refs else None,
        'count': len(itens),
        'arquivos': arquivos,
        'itens': itens,
    }, ensure_ascii=False))

if __name__ == '__main__':
    main()
