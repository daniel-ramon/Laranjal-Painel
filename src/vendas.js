'use strict';
// Página "Vendas": acompanha as vendas (saídas) das 5 frutas na MOVIMENTACAO,
// somando AK (AKHORTIFRUTI/filial 02) + JRF (LARANJAL/filial 01), por DTMOV.
// Duas abas: "Entregas" = clientes da lista (faturados só na AK) e "Ceasa" = demais.
const { EMPRESAS, USE_MOCK } = require('./config');
const dbj = require('./db-jdbc');

// Produtos considerados (mesmos códigos nas duas bases): Laranja, Laranja P,
// Tangerina, Limão, Maracujá.
const CODPROD_FRUTAS = [1, 32, 3, 2, 13];
const NOMES_FRUTAS = {
  1: 'Laranja Pera', 32: 'Laranja Pera P', 3: 'Tangerina Murkot',
  2: 'Limão Tahiti', 13: 'Maracujá',
};

// A aba "Entregas" é definida pelo RAMO DE ATIVIDADE do parceiro (PARCEIROS.CODATIV),
// a mesma regra do relatório "Desempenho por Produto" do ERP. Isso faz os totais
// baterem com o ERP e inclui/exclui clientes automaticamente conforme o cadastro.
// Entregas são faturadas só na AK/filial 02; na JRF tudo é "Ceasa".
const RAMOS_ENTREGAS = [1, 2, 3, 4, 13];

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}
function parseISO(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function maisUmDiaISO(iso) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
// Segunda-feira (ISO) da semana que contém a data — chave para agrupar por semana.
function segundaISO(iso) {
  const d = parseISO(iso);
  const dow = d.getDay();                   // 0=dom..6=sab
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return isoDate(d);
}

// Partes comuns das consultas (FROM, expressão de grupo e filtros WHERE).
// Na AK o grupo vem do ramo de atividade do parceiro (LEFT JOIN a um conjunto
// DISTINCT de CODPARC, para não duplicar linhas da MOVIMENTACAO); na JRF tudo é "Ceasa".
function partesSQL(emp) {
  const T = emp.schema + '.MOVIMENTACAO';
  const P = emp.schema + '.PARCEIROS';
  const from = emp.id === 'AK'
    ? `${T} m LEFT JOIN (SELECT DISTINCT CODPARC FROM ${P} WHERE CODATIV IN (${RAMOS_ENTREGAS.join(',')})) e ON e.CODPARC = m.CODPARC`
    : `${T} m`;
  const grp = emp.id === 'AK'
    ? `CASE WHEN e.CODPARC IS NOT NULL THEN 'E' ELSE 'C' END`
    : `'C'`;
  const where = `WHERE m.OPERACAO IN ('S','ED')
   AND m.CODFILIAL = '${emp.filial}'
   AND m.CODPROD IN (${CODPROD_FRUTAS.join(',')})
   AND m.DTMOV >= TO_DATE(:ini,'YYYY-MM-DD')
   AND m.DTMOV <  TO_DATE(:fim,'YYYY-MM-DD')`;
  // Somas condicionais reutilizadas: bruto (S) e devolução (ED), qtd e valor.
  const sums = `SUM(CASE WHEN m.OPERACAO='S'  THEN m.QT ELSE 0 END) AS QT,
       SUM(CASE WHEN m.OPERACAO='S'  THEN m.QT * m.PUNIT - NVL(m.VLDESC, 0) ELSE 0 END) AS VLR,
       SUM(CASE WHEN m.OPERACAO='ED' THEN m.QT ELSE 0 END) AS DEVQT,
       SUM(CASE WHEN m.OPERACAO='ED' THEN m.QT * m.PUNIT - NVL(m.VLDESC, 0) ELSE 0 END) AS DEVVLR`;
  return { from, grp, where, sums };
}

// Vendas por DIA e grupo (para KPIs, médias e a tabela "Por dia").
function sql(emp) {
  const { from, grp, where, sums } = partesSQL(emp);
  return `SELECT TRUNC(m.DTMOV) AS D, ${grp} AS GRP,
       ${sums},
       COUNT(DISTINCT CASE WHEN m.OPERACAO='S' THEN m.NUMPED END) AS PEDIDOS
  FROM ${from}
 ${where}
 GROUP BY TRUNC(m.DTMOV), ${grp}
 ORDER BY D`;
}

// Totais por PRODUTO e grupo (para a tabela "Por produto").
function sqlProduto(emp) {
  const { from, grp, where, sums } = partesSQL(emp);
  return `SELECT ${grp} AS GRP, m.CODPROD AS CP,
       ${sums}
  FROM ${from}
 ${where}
 GROUP BY ${grp}, m.CODPROD`;
}

// Monta a lista de produtos de um grupo (ordenada por venda bruta desc).
function listaProdutos(mapCod) {
  return [...mapCod.values()].map((p) => ({
    cod: p.cod, nome: NOMES_FRUTAS[p.cod] || ('Produto ' + p.cod),
    qt: round2(p.qt), vlr: round2(p.vlr),
    devQt: round2(p.devQt), devVlr: round2(p.devVlr),
    liqQt: round2(p.qt - p.devQt), liqVlr: round2(p.vlr - p.devVlr),
  })).sort((a, b) => b.vlr - a.vlr);
}

// Divide os totais de um grupo entre os 5 produtos (só para o modo exemplo).
function splitProdutos(resumo) {
  const pesos = [[1, 0.50], [2, 0.20], [3, 0.12], [13, 0.10], [32, 0.08]];
  return pesos.map(([cod, r]) => {
    const qt = round2(resumo.total.qt * r), vlr = round2(resumo.total.vlr * r);
    const devQt = round2(resumo.devolucao.qt * r), devVlr = round2(resumo.devolucao.vlr * r);
    return {
      cod, nome: NOMES_FRUTAS[cod], qt, vlr, devQt, devVlr,
      liqQt: round2(qt - devQt), liqVlr: round2(vlr - devVlr),
    };
  }).sort((a, b) => b.vlr - a.vlr);
}

// Constrói o resumo de um grupo a partir das linhas diárias {data,qt,vlr,ped}.
function resumoGrupo(dias) {
  const serie = dias.slice().sort((a, b) => a.data.localeCompare(b.data));
  const total = serie.reduce((s, x) => ({
    qt: s.qt + x.qt, vlr: s.vlr + x.vlr, ped: s.ped + x.ped,
    devQt: s.devQt + (x.devQt || 0), devVlr: s.devVlr + (x.devVlr || 0),
  }), { qt: 0, vlr: 0, ped: 0, devQt: 0, devVlr: 0 });

  const diasComVenda = serie.filter((x) => x.qt > 0 || x.vlr > 0).length;
  const semanas = new Set(serie.filter((x) => x.qt > 0 || x.vlr > 0).map((x) => segundaISO(x.data)));
  const nSem = semanas.size || 0;
  const divDia = diasComVenda || 1;
  const divSem = nSem || 1;

  return {
    // Médias e "Venda bruta" seguem só as saídas (OPERACAO='S'), iguais à coluna
    // "Venda" do ERP. Devoluções e líquido ficam em campos próprios.
    total: { qt: round2(total.qt), vlr: round2(total.vlr), ped: total.ped },
    devolucao: { qt: round2(total.devQt), vlr: round2(total.devVlr) },
    liquido: { qt: round2(total.qt - total.devQt), vlr: round2(total.vlr - total.devVlr) },
    mediaDiaria: { qt: round2(total.qt / divDia), vlr: round2(total.vlr / divDia) },
    mediaSemanal: { qt: round2(total.qt / divSem), vlr: round2(total.vlr / divSem) },
    dias: diasComVenda,
    semanas: nSem,
    serie: serie.map((x) => ({
      data: x.data, qt: round2(x.qt), vlr: round2(x.vlr), ped: x.ped,
      devQt: round2(x.devQt || 0), devVlr: round2(x.devVlr || 0),
      liqQt: round2(x.qt - (x.devQt || 0)), liqVlr: round2(x.vlr - (x.devVlr || 0)),
    })),
  };
}

// Gera dados de exemplo (modo demonstração, sem banco).
function exemplo(iniISO, fimISO) {
  const diasE = [], diasC = [];
  let d = parseISO(iniISO);
  const fim = parseISO(fimISO);
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (; d <= fim; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;          // fim de semana sem venda
    const iso = isoDate(d);
    const qE = Math.round(12000 + rnd() * 16000);
    const qC = Math.round(6000 + rnd() * 10000);
    const dE = Math.round(qE * (rnd() < 0.5 ? 0.03 : 0));   // devolução eventual
    diasE.push({ data: iso, qt: qE, vlr: round2(qE * 3.2), ped: Math.round(40 + rnd() * 40), devQt: dE, devVlr: round2(dE * 3.2) });
    diasC.push({ data: iso, qt: qC, vlr: round2(qC * 3.0), ped: Math.round(20 + rnd() * 30), devQt: 0, devVlr: 0 });
  }
  const entregas = resumoGrupo(diasE);
  const ceasa = resumoGrupo(diasC);
  return {
    grupos: { entregas, ceasa },
    produtos: { entregas: splitProdutos(entregas), ceasa: splitProdutos(ceasa) },
  };
}

async function listar(iniISO, fimISO) {
  if (USE_MOCK) {
    return Object.assign({ ini: iniISO, fim: fimISO }, exemplo(iniISO, fimISO));
  }
  const fimExcl = maisUmDiaISO(fimISO);
  const [partesDia, partesProd] = await Promise.all([
    Promise.all(EMPRESAS.map((emp) => dbj.query(emp.id, sql(emp), iniISO, fimExcl))),
    Promise.all(EMPRESAS.map((emp) => dbj.query(emp.id, sqlProduto(emp), iniISO, fimExcl))),
  ]);

  // Soma por (dia, grupo) juntando as empresas.
  const mapa = { E: new Map(), C: new Map() };
  partesDia.forEach((rows) => {
    (rows || []).forEach((r) => {
      const g = String(r.GRP) === 'E' ? 'E' : 'C';
      const data = String(r.D).slice(0, 10);
      const cur = mapa[g].get(data) || { data, qt: 0, vlr: 0, ped: 0, devQt: 0, devVlr: 0 };
      cur.qt += Number(r.QT) || 0;
      cur.vlr += Number(r.VLR) || 0;
      cur.devQt += Number(r.DEVQT) || 0;
      cur.devVlr += Number(r.DEVVLR) || 0;
      cur.ped += Number(r.PEDIDOS) || 0;
      mapa[g].set(data, cur);
    });
  });

  // Soma por (produto, grupo) juntando as empresas.
  const prod = { E: new Map(), C: new Map() };
  partesProd.forEach((rows) => {
    (rows || []).forEach((r) => {
      const g = String(r.GRP) === 'E' ? 'E' : 'C';
      const cod = Number(r.CP);
      const cur = prod[g].get(cod) || { cod, qt: 0, vlr: 0, devQt: 0, devVlr: 0 };
      cur.qt += Number(r.QT) || 0;
      cur.vlr += Number(r.VLR) || 0;
      cur.devQt += Number(r.DEVQT) || 0;
      cur.devVlr += Number(r.DEVVLR) || 0;
      prod[g].set(cod, cur);
    });
  });

  return {
    ini: iniISO, fim: fimISO,
    grupos: {
      entregas: resumoGrupo([...mapa.E.values()]),
      ceasa: resumoGrupo([...mapa.C.values()]),
    },
    produtos: {
      entregas: listaProdutos(prod.E),
      ceasa: listaProdutos(prod.C),
    },
  };
}

module.exports = { listar };
