'use strict';
// Página "Vendas": acompanha as vendas (saídas) das 5 frutas na MOVIMENTACAO,
// somando AK (AKHORTIFRUTI/filial 02) + JRF (LARANJAL/filial 01), por DTMOV.
// Duas abas: "Entregas" = clientes da lista (faturados só na AK) e "Ceasa" = demais.
const { EMPRESAS, USE_MOCK } = require('./config');
const dbj = require('./db-jdbc');

// Produtos considerados (mesmos códigos nas duas bases): Laranja, Laranja P,
// Tangerina, Limão, Maracujá.
const CODPROD_FRUTAS = [1, 32, 3, 2, 13];

// Clientes da aba "Entregas" (lista anexada). São faturados só na AK/filial 02.
const CODPARC_ENTREGAS = [
  9, 10, 11, 12, 14, 153, 154, 208, 236, 277, 634, 748, 933, 1270, 1388, 1541, 1571,
  49, 50, 51, 344, 650, 652, 694, 735, 736, 1519, 1536, 967, 1263, 1543, 1512, 1622,
];

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

// SQL de vendas por dia e grupo (Entregas/Ceasa) para uma empresa.
// Na AK o grupo vem do CASE sobre a lista; na JRF tudo é "Ceasa".
function sql(emp) {
  const T = emp.schema + '.MOVIMENTACAO';
  const grp = emp.id === 'AK'
    ? `CASE WHEN m.CODPARC IN (${CODPARC_ENTREGAS.join(',')}) THEN 'E' ELSE 'C' END`
    : `'C'`;
  return `SELECT TRUNC(m.DTMOV) AS D, ${grp} AS GRP,
       SUM(m.QT) AS QT,
       SUM(m.QT * m.PUNIT - NVL(m.VLDESC, 0)) AS VLR,
       COUNT(DISTINCT m.NUMPED) AS PEDIDOS
  FROM ${T} m
 WHERE m.OPERACAO = 'S'
   AND m.CODFILIAL = '${emp.filial}'
   AND m.CODPROD IN (${CODPROD_FRUTAS.join(',')})
   AND m.DTMOV >= TO_DATE(:ini,'YYYY-MM-DD')
   AND m.DTMOV <  TO_DATE(:fim,'YYYY-MM-DD')
 GROUP BY TRUNC(m.DTMOV), ${grp}
 ORDER BY D`;
}

// Constrói o resumo de um grupo a partir das linhas diárias {data,qt,vlr,ped}.
function resumoGrupo(dias) {
  const serie = dias.slice().sort((a, b) => a.data.localeCompare(b.data));
  const total = serie.reduce((s, x) => ({
    qt: s.qt + x.qt, vlr: s.vlr + x.vlr, ped: s.ped + x.ped,
  }), { qt: 0, vlr: 0, ped: 0 });

  const diasComVenda = serie.filter((x) => x.qt > 0 || x.vlr > 0).length;
  const semanas = new Set(serie.filter((x) => x.qt > 0 || x.vlr > 0).map((x) => segundaISO(x.data)));
  const nSem = semanas.size || 0;
  const divDia = diasComVenda || 1;
  const divSem = nSem || 1;

  return {
    total: { qt: round2(total.qt), vlr: round2(total.vlr), ped: total.ped },
    mediaDiaria: { qt: round2(total.qt / divDia), vlr: round2(total.vlr / divDia) },
    mediaSemanal: { qt: round2(total.qt / divSem), vlr: round2(total.vlr / divSem) },
    dias: diasComVenda,
    semanas: nSem,
    serie: serie.map((x) => ({ data: x.data, qt: round2(x.qt), vlr: round2(x.vlr), ped: x.ped })),
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
    diasE.push({ data: iso, qt: qE, vlr: round2(qE * 3.2), ped: Math.round(40 + rnd() * 40) });
    diasC.push({ data: iso, qt: qC, vlr: round2(qC * 3.0), ped: Math.round(20 + rnd() * 30) });
  }
  return { entregas: resumoGrupo(diasE), ceasa: resumoGrupo(diasC) };
}

async function listar(iniISO, fimISO) {
  if (USE_MOCK) {
    return { ini: iniISO, fim: fimISO, grupos: exemplo(iniISO, fimISO) };
  }
  const fimExcl = maisUmDiaISO(fimISO);
  const partes = await Promise.all(EMPRESAS.map((emp) => dbj.query(emp.id, sql(emp), iniISO, fimExcl)));

  // Soma por (dia, grupo) juntando as empresas.
  const mapa = { E: new Map(), C: new Map() };
  partes.forEach((rows) => {
    (rows || []).forEach((r) => {
      const g = String(r.GRP) === 'E' ? 'E' : 'C';
      const data = String(r.D).slice(0, 10);
      const cur = mapa[g].get(data) || { data, qt: 0, vlr: 0, ped: 0 };
      cur.qt += Number(r.QT) || 0;
      cur.vlr += Number(r.VLR) || 0;
      cur.ped += Number(r.PEDIDOS) || 0;
      mapa[g].set(data, cur);
    });
  });

  return {
    ini: iniISO, fim: fimISO,
    grupos: {
      entregas: resumoGrupo([...mapa.E.values()]),
      ceasa: resumoGrupo([...mapa.C.values()]),
    },
  };
}

module.exports = { listar };
