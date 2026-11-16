'use strict';
const path = require('path');
const { spawn } = require('child_process');
const { EMPRESAS, JAVA_BIN, OJDBC_JAR } = require('./config');

const CLASS_DIR = path.join(__dirname, '..', 'java'); // onde está OraRunner.class

// Executa um SQL (com :ini/:fim) numa base via ponte Java/JDBC. Retorna linhas (objetos).
function query(empresaId, sql, iniISO, fimISO) {
  const emp = EMPRESAS.find((e) => e.id === empresaId);
  if (!emp) return Promise.reject(new Error('Empresa desconhecida: ' + empresaId));

  // o OraRunner usa '?' posicionais (ini, fim)
  const sqlJ = sql.replace(':ini', '?').replace(':fim', '?');
  const cp = OJDBC_JAR + path.delimiter + CLASS_DIR;
  const stdin = [emp.jdbcUrl, emp.user, emp.password, iniISO, fimISO, sqlJ].join('\n');

  return new Promise((resolve, reject) => {
    const p = spawn(JAVA_BIN, ['-Dfile.encoding=UTF-8', '-cp', cp, 'OraRunner'], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error('Falha ao iniciar Java: ' + e.message)));
    p.on('close', (code) => {
      if (code === 0) {
        try { resolve(JSON.parse(out || '[]')); }
        catch (e) { reject(new Error('Resposta inválida do JDBC: ' + e.message)); }
      } else {
        reject(new Error('[' + empresaId + '] ' + (err.trim() || ('java saiu com código ' + code))));
      }
    });
    p.stdin.on('error', () => {});
    p.stdin.write(stdin);
    p.stdin.end();
  });
}

module.exports = { query };
