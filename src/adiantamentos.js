'use strict';
const path = require('path');
const { spawn } = require('child_process');
const { PYTHON_BIN, NORDESTAO } = require('./config');

const SCRIPT = path.join(__dirname, '..', 'tools', 'read_adiantamentos.py');

// Executa o parser Python sobre a pasta de adiantamentos e devolve o objeto.
function carregar() {
  return new Promise((resolve) => {
    const args = [SCRIPT, NORDESTAO.pastaArquivos];
    const env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
    const p = spawn(PYTHON_BIN, args, { windowsHide: true, env });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ ok: false, erro: 'Falha ao iniciar Python: ' + e.message, itens: {}, min: null, count: 0 }));
    p.on('close', () => {
      try {
        resolve(JSON.parse(out || '{}'));
      } catch (e) {
        resolve({ ok: false, erro: (err.trim() || e.message), itens: {}, min: null, count: 0 });
      }
    });
  });
}

// Cache curto (10s) para não reprocessar a planilha a cada requisição.
let cache = null, cacheTime = 0;
async function get() {
  if (cache && Date.now() - cacheTime < 10000) return cache;
  cache = await carregar();
  cacheTime = Date.now();
  return cache;
}

module.exports = { get };
