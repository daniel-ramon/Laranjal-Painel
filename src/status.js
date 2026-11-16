'use strict';

// ---- Helpers de data (meia-noite local) ----
function atMidnight(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function today() {
  return atMidnight(new Date());
}
// Lê 'YYYY-MM-DD' como data LOCAL (evita o deslocamento de fuso do new Date(string)).
function parseLocalISO(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
// Semana atual: segunda (início) a domingo (fim), inclusivo.
function weekRange(ref = today()) {
  const d = atMidnight(ref);
  const dow = d.getDay();                 // 0=dom ... 6=sab
  const diffToMon = (dow === 0 ? -6 : 1 - dow);
  const start = new Date(d); start.setDate(d.getDate() + diffToMon);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { start: atMidnight(start), end: atMidnight(end) };
}
// Primeiro dia do mês e primeiro dia do mês seguinte (para range [ini, fim)).
function monthRange(mes /* 'YYYY-MM' */) {
  const [y, m] = mes.split('-').map(Number);
  const ini = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const fim = new Date(y, m, 1, 0, 0, 0, 0);
  return { ini, fim };
}
function diasEntre(a, b) {
  return Math.round((atMidnight(a) - atMidnight(b)) / 86400000);
}

// Calcula flags de situação de um título.
function classificar(titulo, ref = today()) {
  const hoje = atMidnight(ref);
  const { start: wkIni, end: wkFim } = weekRange(hoje);
  const venc = parseLocalISO(titulo.dtvenc);
  const pago = (titulo.pago !== undefined) ? !!titulo.pago : !!titulo.dtbaixa;

  const isPago = pago;
  const isVencido = !pago && venc < hoje;
  const isVenceHoje = !pago && venc.getTime() === hoje.getTime();
  // "vence esta semana" = de hoje até domingo (não inclui os já vencidos)
  const isVenceSemana = !pago && venc >= hoje && venc <= wkFim;
  const isProximo = !pago && venc > hoje;

  // rótulo primário (para a pílula de status na lista)
  let situacao = 'proximo';
  if (isPago) situacao = 'pago';
  else if (isVencido) situacao = 'vencido';
  else if (isVenceHoje) situacao = 'vence_hoje';
  else if (isVenceSemana) situacao = 'vence_semana';

  return {
    ...titulo,
    isPago, isVencido, isVenceHoje, isVenceSemana, isProximo,
    situacao,
    diasParaVenc: diasEntre(venc, hoje),
  };
}

function somaValor(linhas) {
  const s = linhas.reduce((acc, t) => acc + (Number(t.valor) || 0), 0);
  return Math.round(s * 100) / 100; // evita resíduo de ponto flutuante
}

// Agrega totais por filtro, com quebra por empresa.
function agregar(titulos) {
  const cls = titulos.map((t) => classificar(t));
  const porEmpresa = (pred) => {
    const sel = cls.filter(pred);
    const byAK = sel.filter((t) => t.origem === 'AK');
    const byJRF = sel.filter((t) => t.origem === 'JRF');
    return {
      qtd: sel.length,
      valor: somaValor(sel),
      ak: { qtd: byAK.length, valor: somaValor(byAK) },
      jrf: { qtd: byJRF.length, valor: somaValor(byJRF) },
    };
  };

  return {
    linhas: cls,
    cards: {
      vencemHoje: porEmpresa((t) => t.isVenceHoje),
      proximos: porEmpresa((t) => t.isProximo),
      atrasados: porEmpresa((t) => t.isVencido),
    },
    kpis: {
      vencidos: porEmpresa((t) => t.isVencido),
      hoje: porEmpresa((t) => t.isVenceHoje),
      semana: porEmpresa((t) => t.isVenceSemana),
      pagos: porEmpresa((t) => t.isPago),
    },
    totalGeral: porEmpresa(() => true),
  };
}

module.exports = { atMidnight, today, weekRange, monthRange, classificar, agregar };
