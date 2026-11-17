'use strict';
// Dados de exemplo para rodar o painel sem o banco.
// Gera títulos com vencimentos ao redor de HOJE, para popular os cards/KPIs.

const FORNECEDORES = [
  'Distribuidora Verde Folha', 'Atacado Pomar Real', 'Embalagens Nova Era',
  'Transporte Rápido Sul', 'Hortifruti Central', 'Frigorífico Boa Carne',
  'Energia & Cia', 'Água Mineral Serra', 'Papelaria União', 'Limpeza Total',
  'Banco Credi', 'Prefeitura (Tributos)', 'Cooperativa Agro', 'Gás Industrial',
];

function addDays(base, n) {
  const d = new Date(base); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  return d;
}

function gerar(mes /* 'YYYY-MM' */) {
  const [y, m] = mes.split('-').map(Number);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const mesAtual = (hoje.getFullYear() === y && (hoje.getMonth() + 1) === m);

  // Deslocamentos de vencimento (em dias a partir de hoje) e se está pago.
  const plano = mesAtual
    ? [
        [-25, true], [-18, true], [-12, false], [-9, false], [-5, false], [-2, false],
        [0, false], [0, false], [1, false], [2, false], [3, false], [4, false],
        [6, false], [8, false], [12, false], [16, false], [20, true], [24, false],
      ]
    : [
        // mês fora do atual: distribui dentro do mês escolhido
        [2, true], [5, true], [8, false], [11, false], [14, false], [17, false],
        [20, false], [23, true], [26, false],
      ];

  const empresas = ['AK', 'JRF'];
  const linhas = [];
  let seq = 1000;

  plano.forEach((p, idx) => {
    empresas.forEach((origem, e) => {
      const base = mesAtual ? hoje : new Date(y, m - 1, 1);
      const dtvenc = mesAtual ? addDays(hoje, p[0]) : addDays(base, p[0]);
      const pago = p[1];
      const valor = Math.round((800 + ((idx * 737 + e * 1234) % 9000)) / 10) * 10
        + (origem === 'JRF' ? 55 : 0);
      const fornIdx = (idx * 2 + e) % FORNECEDORES.length;
      linhas.push({
        origem,
        numlanc: ++seq,
        filial: origem === 'AK' ? '01' : '01',
        codfornec: 100 + fornIdx,
        fornecedor: FORNECEDORES[fornIdx],
        numnota: 20000 + seq,
        valor,
        vpago: pago ? valor : 0,
        dtvenc: dtvenc.toISOString().slice(0, 10),
        dtbaixa: pago ? addDays(dtvenc, -1).toISOString().slice(0, 10) : null,
        emissao: addDays(dtvenc, -30).toISOString().slice(0, 10),
        status: pago ? 'B' : 'A',
        pago,
        historico: 'Título ' + (origem) + ' ' + FORNECEDORES[fornIdx],
      });
    });
  });

  return linhas;
}

// Gera o plano ao redor de HOJE e filtra pelos vencimentos no período [ini, fim]
// (ambos inclusivos). Serve ao filtro por data de vencimento da página de contas.
function gerarPeriodo(iniS, fimS) {
  const hoje = new Date();
  const mesHoje = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
  return gerar(mesHoje).filter((t) => t.dtvenc >= iniS && t.dtvenc <= fimS);
}

module.exports = { gerar, gerarPeriodo };
