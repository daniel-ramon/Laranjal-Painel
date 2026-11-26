'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const { PORT, USE_MOCK, EMPRESAS } = require('./src/config');
const { buscarTitulos, buscarTitulosPorPeriodo } = require('./src/queries');
const { agregar, monthRange } = require('./src/status');
const nordestao = require('./src/nordestao');
const adiantamentos = require('./src/adiantamentos');
const vendas = require('./src/vendas');
const entregas = require('./src/entregas');
const bradesco = require('./src/bradesco');
const dre = require('./src/dre');
const dreAlertas = require('./src/dre-alertas');
const dreIA = require('./src/dre-ia');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function mesPadrao() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function validarMes(m) {
  return /^\d{4}-\d{2}$/.test(m || '') ? m : mesPadrao();
}
function validarData(s, fallback) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : fallback;
}
function primeiroDiaMes() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
}
function hojeISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}
function segundaDestaSemanaISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const dow = d.getDay();                         // 0=dom..6=sab
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}

app.get('/api/empresas', (req, res) => {
  res.json(EMPRESAS.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor })));
});

app.get('/api/overview', async (req, res) => {
  try {
    const mes = validarMes(req.query.mes);
    const titulos = await buscarTitulos(mes);
    const ag = agregar(titulos);
    res.json({
      mes, modo: USE_MOCK ? 'exemplo' : 'oracle',
      cards: ag.cards,
      totalGeral: ag.totalGeral,
      empresas: EMPRESAS.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor })),
    });
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
});

app.get('/api/contas', async (req, res) => {
  try {
    // Filtro por data de vencimento: [ini, fim] inclusivo.
    // Padrão: 1º dia do mês corrente até hoje.
    const ini = validarData(req.query.ini, primeiroDiaMes());
    const fim = validarData(req.query.fim, hojeISO());
    const titulos = await buscarTitulosPorPeriodo(ini, fim);
    const ag = agregar(titulos);
    res.json({
      ini, fim, modo: USE_MOCK ? 'exemplo' : 'oracle',
      kpis: ag.kpis,
      totalGeral: ag.totalGeral,
      titulos: ag.linhas,
      empresas: EMPRESAS.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor })),
    });
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
});

app.get('/api/nordestao', async (req, res) => {
  try {
    const ini = validarData(req.query.ini, primeiroDiaMes());
    const fim = validarData(req.query.fim, hojeISO());
    const dados = await nordestao.listar(ini, fim);
    res.json(Object.assign({ modo: USE_MOCK ? 'exemplo' : 'oracle' }, dados));
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
});

app.get('/api/nordestao/itens', async (req, res) => {
  try {
    const numvenda = parseInt(req.query.numvenda, 10);
    if (!Number.isFinite(numvenda)) return res.status(400).json({ erro: 'numvenda inválido' });
    res.json(await nordestao.itens(numvenda));
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
});

// Upload de uma planilha .xlsx para a pasta de adiantamentos.
// O corpo é o binário cru do arquivo; o nome vem no header X-Filename (URL-encoded).
app.post('/api/nordestao/upload', express.raw({ type: '*/*', limit: '30mb' }), (req, res) => {
  try {
    let nome = req.get('X-Filename') || 'upload.xlsx';
    try { nome = decodeURIComponent(nome); } catch (_) {}
    const arquivo = adiantamentos.salvar(nome, req.body);
    res.json({ ok: true, arquivo });
  } catch (e) {
    res.status(400).json({ ok: false, erro: String(e.message || e) });
  }
});

// ===== Vendas (saídas das 5 frutas por DTMOV; AK filial 02 + JRF filial 01) =====
app.get('/api/vendas', async (req, res) => {
  try {
    const ini = validarData(req.query.ini, segundaDestaSemanaISO());
    const fim = validarData(req.query.fim, hojeISO());
    const dados = await vendas.listar(ini, fim);
    res.json(Object.assign({ modo: USE_MOCK ? 'exemplo' : 'oracle' }, dados));
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
});

// Planejamento de compra: quantidade por produto × dia da semana nas N últimas
// semanas fechadas (padrão 4). Só quantidade; o período é calculado no servidor.
app.get('/api/vendas/planejamento', async (req, res) => {
  try {
    const dados = await vendas.planejamento(req.query.semanas);
    res.json(Object.assign({ modo: USE_MOCK ? 'exemplo' : 'oracle' }, dados));
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
});

// ===== Entregas (acompanhamento por caminhão/rota) =====
app.get('/api/entregas', (req, res) => {
  try { res.json(entregas.montar(req.query.data)); }
  catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});
app.post('/api/entregas/rotas', (req, res) => {
  try { res.json(entregas.addRota(req.body || {})); }
  catch (e) { res.status(400).json({ erro: String(e.message || e) }); }
});
app.put('/api/entregas/rotas/:codigo', (req, res) => {
  try { res.json(entregas.editRota(req.params.codigo, req.body || {})); }
  catch (e) { res.status(400).json({ erro: String(e.message || e) }); }
});
app.delete('/api/entregas/rotas/:codigo', (req, res) => {
  try { res.json(entregas.deleteRota(req.params.codigo)); }
  catch (e) { res.status(400).json({ erro: String(e.message || e) }); }
});
app.put('/api/entregas/lojas/:cnpj', (req, res) => {
  try { res.json(entregas.moverLoja(req.params.cnpj, (req.body || {}).rota)); }
  catch (e) { res.status(400).json({ erro: String(e.message || e) }); }
});
// Folha de separação em PDF (todos ou por rota) — mesmo formato do gerar_separacao.py.
app.get('/api/entregas/folha', (req, res) => {
  try {
    const r = entregas.folhaPdf(req.query.data, req.query.rota || null);
    if (!r.ok) {
      if (r.vazio) return res.status(404).send('Sem pedidos para esta data/rota.');
      return res.status(500).send('Falha ao gerar a folha: ' + (r.erro || ''));
    }
    const nome = 'separacao_' + (req.query.data || '') + (req.query.rota ? '_rota' + req.query.rota : '') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="' + nome + '"');
    res.sendFile(r.pdf, (err) => { fs.unlink(r.pdf, () => {}); if (err && !res.headersSent) res.status(500).end(); });
  } catch (e) { res.status(500).send(String(e.message || e)); }
});

// ===== Banco / Bradesco (extrato de conta corrente) =====
app.get('/api/bradesco', (req, res) => {
  try {
    const demo = String(req.query.fonte || '') === 'demo';
    const ini = validarData(req.query.ini, primeiroDiaMes());
    const fim = validarData(req.query.fim, hojeISO());
    res.json(bradesco.consultar(ini, fim, { demo }));
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

// ===== Despesas (DRE analítico) =====
// Árvore grupo > conta > lançamento por DTPAGO, com comparativos e alertas.
app.get('/api/dre', async (req, res) => {
  try {
    const ini = validarData(req.query.ini, primeiroDiaMes());
    const fim = validarData(req.query.fim, hojeISO());
    const dados = await dre.listar(ini, fim);
    const analise = dreAlertas.analisar(dados, { hoje: hojeISO() });
    res.json(Object.assign({ modo: USE_MOCK ? 'exemplo' : 'oracle', iaDisponivel: dreIA.disponivel() }, dados, { analise }));
  } catch (e) {
    res.status(500).json({ erro: String(e.message || e) });
  }
});

// Diagnóstico escrito pela Claude API (só comenta os números já calculados).
app.get('/api/dre/analise', async (req, res) => {
  try {
    const ini = validarData(req.query.ini, primeiroDiaMes());
    const fim = validarData(req.query.fim, hojeISO());
    const dados = await dre.listar(ini, fim);
    const analise = dreAlertas.analisar(dados, { hoje: hojeISO() });
    const ia = await dreIA.analisar(dados, analise, { forcar: String(req.query.forcar || '') === '1' });
    res.json(ia);
  } catch (e) {
    res.status(500).json({ ok: false, erro: String(e.message || e) });
  }
});

app.get('/', (req, res) => res.redirect('/index.html'));

app.listen(PORT, () => {
  console.log(`Painel CP rodando em http://localhost:${PORT}  (modo: ${USE_MOCK ? 'EXEMPLO' : 'ORACLE'})`);
});
