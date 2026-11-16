'use strict';
// Consulta o extrato do Bradesco chamando a ponte Python (tools/extrato_bradesco.py),
// que por sua vez usa o projeto copiado em extrato-bradesco/. Somente leitura.

const { spawnSync } = require('child_process');
const { BRADESCO, PYTHON_BIN } = require('./config');

function validarData(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s || '');
}

// Executa a ponte e devolve o JSON já parseado. Nunca lança por erro de negócio:
// devolve { ok:false, erro } para o chamador exibir.
function consultar(iniISO, fimISO, { demo = false } = {}) {
  let inicio = iniISO;
  let fim = fimISO;
  const args = [BRADESCO.bridge];

  if (demo) {
    // O stub do sandbox só responde ao intervalo exato do manual.
    inicio = BRADESCO.demoPeriodo.inicio;
    fim = BRADESCO.demoPeriodo.fim;
    args.push('--payload', BRADESCO.demoPayload);
  }
  if (!validarData(inicio) || !validarData(fim)) {
    return { ok: false, erro: 'data inválida (use AAAA-MM-DD)' };
  }
  args.push('--data-inicio', inicio, '--data-fim', fim);

  const r = spawnSync(PYTHON_BIN, args, {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }),
    timeout: 120000,
  });

  if (r.error) {
    return { ok: false, erro: 'falha ao executar Python: ' + r.error.message };
  }
  const saida = (r.stdout || '').trim();
  if (!saida) {
    return { ok: false, erro: 'sem resposta da ponte: ' + String(r.stderr || '').slice(-300) };
  }
  try {
    // A ponte pode logar no stderr; o JSON é sempre a última linha do stdout.
    const linha = saida.split(/\r?\n/).filter(Boolean).pop();
    const dados = JSON.parse(linha);
    dados.fonte = demo ? 'demo' : 'api';
    return dados;
  } catch (e) {
    return { ok: false, erro: 'resposta inválida da ponte: ' + saida.slice(-300) };
  }
}

module.exports = { consultar };
