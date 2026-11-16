'use strict';
const { EMPRESAS, ORACLE_CLIENT_LIB_DIR, ORACLE_TNS_ADMIN } = require('./config');

// Carrega oracledb só quando for usar banco real (evita exigir o client no modo mock).
let oracledb = null;
let clientInit = false;
const pools = {}; // id -> pool

function getOracledb() {
  if (!oracledb) {
    oracledb = require('oracledb');
    oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
    oracledb.fetchAsString = [oracledb.CLOB];
  }
  if (!clientInit) {
    // Thick mode: necessário para Oracle 10g/11g. libDir = Instant Client 64-bit;
    // configDir = pasta do tnsnames.ora (reaproveita os aliases AK/ORCL já existentes).
    const opts = {};
    if (ORACLE_CLIENT_LIB_DIR) opts.libDir = ORACLE_CLIENT_LIB_DIR;
    if (ORACLE_TNS_ADMIN) opts.configDir = ORACLE_TNS_ADMIN;
    oracledb.initOracleClient(opts);
    clientInit = true;
  }
  return oracledb;
}

async function getPool(empresaId) {
  if (pools[empresaId]) return pools[empresaId];
  const emp = EMPRESAS.find((e) => e.id === empresaId);
  if (!emp) throw new Error('Empresa desconhecida: ' + empresaId);
  const odb = getOracledb();
  pools[empresaId] = await odb.createPool({
    user: emp.user,
    password: emp.password,
    connectString: emp.connectString,
    poolMin: 0,
    poolMax: 4,
    poolTimeout: 60,
  });
  return pools[empresaId];
}

async function query(empresaId, sql, binds = {}) {
  const pool = await getPool(empresaId);
  const conn = await pool.getConnection();
  try {
    const r = await conn.execute(sql, binds);
    return r.rows || [];
  } finally {
    await conn.close();
  }
}

async function closeAll() {
  for (const id of Object.keys(pools)) {
    try { await pools[id].close(5); } catch (_) {}
  }
}

module.exports = { query, closeAll };
