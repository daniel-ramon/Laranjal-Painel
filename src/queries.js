'use strict';
const { USE_MOCK, DRIVER, EMPRESAS, CPAGAR } = require('./config');
const { monthRange } = require('./status');
const mock = require('./mock');

// Monta o SQL da CPAGAR para o range de vencimento [ini, fim).
function montarSQL(emp) {
  const c = CPAGAR.col;
  const T = emp.schema + '.' + CPAGAR.tabela;
  const f = CPAGAR.fornecedor;

  const campos = [
    `t.${c.id}            AS NUMLANC`,
    `t.${c.filial}        AS FILIAL`,
    `t.${c.fornecedorCod} AS CODFORNEC`,
    `t.${c.numNota}       AS NUMNOTA`,
    `t.${c.valor}         AS VALOR`,
    `t.${c.valorPago}     AS VPAGO`,
    `t.${c.vencimento}    AS DTVENC`,
    `t.${c.baixa}         AS DTBAIXA`,
    `t.${c.dtpago}        AS DTPAGO`,
    `t.${c.emissao}       AS DTEMISSAO`,
    `t.${c.status}        AS STATUS`,
    `t.${c.historico}     AS HISTORICO`,
  ];
  let fromJoin = `${T} t`;
  if (f) {
    campos.push(`fo.${f.colNome} AS FORNECEDOR`);
    let on = `fo.${f.colCod} = t.${c.fornecedorCod}`;
    // PARCEIROS tem PK composta (CODPARC+TIPOPARC); casar o tipo evita multiplicar linhas.
    if (f.colTipo && c.tipoParceiro) on += ` AND fo.${f.colTipo} = t.${c.tipoParceiro}`;
    fromJoin += ` LEFT JOIN ${emp.schema}.${f.tabela} fo ON ${on}`;
  }

  let where = `WHERE t.${c.vencimento} >= TO_DATE(:ini,'YYYY-MM-DD') AND t.${c.vencimento} < TO_DATE(:fim,'YYYY-MM-DD')`;
  // Filtro de filial por empresa (AK=02, JRF=01). Valor é constante do config (não é entrada do usuário).
  if (emp.filial) {
    where += ` AND t.${c.filial} = '${String(emp.filial).replace(/'/g, "''")}'`;
  }
  if (CPAGAR.statusExcluir && CPAGAR.statusExcluir.length) {
    const inList = CPAGAR.statusExcluir.map((s) => `'${s}'`).join(',');
    where += ` AND NVL(t.${c.status},'X') NOT IN (${inList})`;
  }

  return `SELECT ${campos.join(', ')} FROM ${fromJoin} ${where} ORDER BY t.${c.vencimento}`;
}

function normalizar(origem, row) {
  const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
  return {
    origem,
    numlanc: row.NUMLANC,
    filial: row.FILIAL,
    codfornec: row.CODFORNEC,
    fornecedor: row.FORNECEDOR || ('Fornecedor ' + row.CODFORNEC),
    numnota: row.NUMNOTA,
    valor: Number(row.VALOR) || 0,
    vpago: Number(row.VPAGO) || 0,
    dtvenc: d(row.DTVENC),
    dtbaixa: d(row.DTBAIXA),
    dtpago: d(row.DTPAGO),
    emissao: d(row.DTEMISSAO),
    status: row.STATUS,
    pago: !!(row.DTBAIXA || row.DTPAGO),   // pago = tem baixa OU data de pagamento
    historico: row.HISTORICO,
  };
}

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

// Busca os títulos das duas empresas para o mês informado.
async function buscarTitulos(mes) {
  if (USE_MOCK) return mock.gerar(mes);

  const { ini, fim } = monthRange(mes);
  const iniS = isoDate(ini), fimS = isoDate(fim);
  const todas = [];
  for (const emp of EMPRESAS) {
    const sql = montarSQL(emp);
    let rows;
    if (DRIVER === 'jdbc') {
      rows = await require('./db-jdbc').query(emp.id, sql, iniS, fimS);
    } else {
      rows = await require('./db').query(emp.id, sql, { ini: iniS, fim: fimS });
    }
    rows.forEach((r) => todas.push(normalizar(emp.id, r)));
  }
  return todas;
}

module.exports = { buscarTitulos, montarSQL };
