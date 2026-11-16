'use strict';
const { EMPRESAS, NORDESTAO } = require('./config');
const dbj = require('./db-jdbc');
const adiant = require('./adiantamentos');

function empresa() {
  return EMPRESAS.find((e) => e.id === NORDESTAO.base);
}
function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}
function toISO(v) {
  return v ? new Date(v).toISOString().slice(0, 10) : null;
}
function diasEntreISO(aISO, bISO) {
  if (!aISO || !bISO) return null;
  const a = new Date(aISO + 'T00:00:00');
  const b = new Date(bISO + 'T00:00:00');
  return Math.round((a - b) / 86400000);
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
// Soma 1 dia a uma data 'YYYY-MM-DD' (para o limite superior exclusivo da consulta).
function maisUmDiaISO(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')
    + '-' + String(dt.getDate()).padStart(2, '0');
}

// SQL da lista de títulos do mês (contas a receber do Nordestão, por emissão).
function sqlLista(emp) {
  const c = NORDESTAO.creceber.col;
  const T = emp.schema + '.' + NORDESTAO.creceber.tabela;
  const cli = NORDESTAO.creceber.clienteTab;
  const inCods = NORDESTAO.codigos.join(',');
  return `SELECT r.${c.numNota} AS NUMNOTA, r.${c.numVenda} AS NUMVENDA, r.${c.cliente} AS CODCLI,
       cl.${cli.colNome} AS LOJA, r.${c.prest} AS PREST,
       r.${c.emissao} AS DTEMISSAO, r.${c.vencimento} AS DTVENC,
       r.${c.valor} AS VALOR, r.${c.vpago} AS VPAGO, r.${c.dtpago} AS DTPAGO
  FROM ${T} r
  LEFT JOIN ${emp.schema}.${cli.tabela} cl ON cl.${cli.colCod} = r.${c.cliente}
 WHERE r.${c.cliente} IN (${inCods})
   ${NORDESTAO.filial ? `AND r.${c.filial} = '${String(NORDESTAO.filial).replace(/'/g, "''")}'` : ''}
   AND (r.${c.codcob} IS NULL OR r.${c.codcob} NOT IN ('DESD', 'CRED'))
   AND r.${c.emissao} >= TO_DATE(:ini,'YYYY-MM-DD')
   AND r.${c.emissao} <  TO_DATE(:fim,'YYYY-MM-DD')
 ORDER BY r.${c.emissao}, r.${c.numNota}`;
}

// SQL dos itens de um pedido (por NUMVENDA), vindos da MOVIMENTACAO.
function sqlItens(emp, numvenda) {
  const m = NORDESTAO.movimentacao.col;
  const T = emp.schema + '.' + NORDESTAO.movimentacao.tabela;
  const pr = NORDESTAO.movimentacao.produtoTab;
  const nv = parseInt(numvenda, 10);
  // :ini/:fim exigidos pela ponte JDBC (2 binds); aqui são inócuos.
  return `SELECT m.${m.codProd} AS CODPROD, pr.${pr.colNome} AS DESCRICAO,
       m.${m.qt} AS QT, m.${m.punit} AS PUNIT
  FROM ${T} m
  LEFT JOIN ${emp.schema}.${pr.tabela} pr ON pr.${pr.colCod} = m.${m.codProd}
 WHERE m.${m.numVenda} = ${nv}
   AND m.${m.operacao} = '${NORDESTAO.movimentacao.operacaoVenda}'
   AND :ini IS NOT NULL AND :fim IS NOT NULL
 ORDER BY m.${m.codProd}`;
}

// Calcula desconto (composto) do adiantamento e o valor recebido estimado.
function calcAdiantamento(valorTotal, taxaMes, dias) {
  if (!valorTotal || taxaMes == null || dias == null) return null;
  const fator = Math.pow(1 + taxaMes / 100, dias / 30) - 1;
  const desconto = round2(valorTotal * fator);
  return { fator, desconto, recebido: round2(valorTotal - desconto) };
}

async function listar(iniISO, fimISO) {
  const emp = empresa();
  // iniISO/fimISO chegam inclusivos; a consulta usa [ini, fimExcl) → soma 1 dia no fim.
  const fimExcl = maisUmDiaISO(fimISO);
  const [rows, ad] = await Promise.all([
    dbj.query(emp.id, sqlLista(emp), iniISO, fimExcl),
    adiant.get(),
  ]);
  const itensAd = (ad && ad.itens) || {};
  const minRef = ad && ad.min != null ? ad.min : null;

  const titulos = rows.map((r) => {
    const numnota = Number(r.NUMNOTA);
    const valor = Number(r.VALOR) || 0;
    const info = itensAd[String(numnota)] || null;
    const dtpagoISO = toISO(r.DTPAGO);
    const pago = !!dtpagoISO;                         // DTPAGO preenchida = já negociado
    const adiantadoAnterior = minRef != null && numnota < minRef;
    const adiantado = !!info || adiantadoAnterior || pago;
    const fonte = info ? 'arquivo' : (pago ? 'pago' : (adiantadoAnterior ? 'anterior' : null));

    let ad1 = null;
    if (info) {
      const taxa = info.taxa != null ? info.taxa : NORDESTAO.taxaPadrao;
      const dias = info.dias != null ? info.dias : diasEntreISO(info.dataVencimento, info.dataPagamento);
      const calc = calcAdiantamento(valor, taxa, dias);
      ad1 = {
        taxa, dias,
        dataPagamento: info.dataPagamento,
        dataVencimento: info.dataVencimento,
        descontoEst: calc ? calc.desconto : null,
        recebidoEst: calc ? calc.recebido : null,
        descontoArq: info.descontoArq,
        valorLiquidoArq: info.valorLiquidoArq,
        montanteArq: info.montante,
      };
    }
    return {
      numnota, numvenda: Number(r.NUMVENDA), codcli: Number(r.CODCLI),
      loja: r.LOJA || ('Loja ' + r.CODCLI), prest: r.PREST,
      emissao: toISO(r.DTEMISSAO), dtvenc: toISO(r.DTVENC),
      valor, vpago: Number(r.VPAGO) || 0, dtpago: toISO(r.DTPAGO),
      adiantado, fonte, adiantamento: ad1,
    };
  });

  // resumo
  const soma = (arr) => round2(arr.reduce((s, t) => s + t.valor, 0));
  const adiantados = titulos.filter((t) => t.adiantado);
  const pendentes = titulos.filter((t) => !t.adiantado);
  const recebidoEst = round2(adiantados.reduce((s, t) => s + (t.adiantamento ? (t.adiantamento.recebidoEst || 0) : 0), 0));
  const descontoEst = round2(adiantados.reduce((s, t) => s + (t.adiantamento ? (t.adiantamento.descontoEst || 0) : 0), 0));

  return {
    ini: iniISO,
    fim: fimISO,
    titulos,
    resumo: {
      qtd: titulos.length, valor: soma(titulos),
      adiantados: { qtd: adiantados.length, valor: soma(adiantados), recebidoEst, descontoEst },
      pendentes: { qtd: pendentes.length, valor: soma(pendentes) },
    },
    fonte: {
      ok: ad && ad.ok, min: minRef, max: ad ? ad.max : null, count: ad ? ad.count : 0,
      arquivos: ad ? ad.arquivos : [], erro: ad ? ad.erro : null,
    },
  };
}

async function itens(numvenda) {
  const emp = empresa();
  const rows = await dbj.query(emp.id, sqlItens(emp, numvenda), '2000-01-01', '2000-01-01');
  const lista = rows.map((r) => {
    const qt = Number(r.QT) || 0;
    const punit = Number(r.PUNIT) || 0;
    return {
      codprod: Number(r.CODPROD),
      descricao: r.DESCRICAO || ('Produto ' + r.CODPROD),
      qt, punit, total: round2(qt * punit),
    };
  });
  const totalItens = round2(lista.reduce((s, i) => s + i.total, 0));
  return { numvenda: Number(numvenda), itens: lista, totalItens };
}

module.exports = { listar, itens };
