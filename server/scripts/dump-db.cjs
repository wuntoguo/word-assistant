#!/usr/bin/env node
/**
 * Dump SQLite database to SQL format (stdout).
 * Usage: NODE_PATH=/app/server/node_modules node dump-db.cjs
 * Or:    cd /app/server && node scripts/dump-db.cjs
 */
const Database = require('better-sqlite3');
const path = process.env.DATABASE_PATH || '/data/data.db';

const db = new Database(path, { readonly: true });

// Schema (CREATE TABLE, indexes)
const schema = db.prepare(`
  SELECT sql FROM sqlite_master
  WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
  ORDER BY type='table' DESC, name
`).all();

for (const row of schema) {
  console.log(row.sql + ';');
}

// Data
const tables = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
`).all();

function escape(val) {
  if (val === null) return 'NULL';
  if (typeof val === 'number') return String(val);
  return "'" + String(val).replace(/'/g, "''").replace(/\n/g, '\\n').replace(/\r/g, '\\r') + "'";
}

for (const { name } of tables) {
  const columns = db.prepare(`PRAGMA table_info(${name})`).all();
  const colNames = columns.map(c => c.name).join(', ');
  const rows = db.prepare(`SELECT * FROM ${name}`).all();
  for (const row of rows) {
    const vals = columns.map(c => escape(row[c.name]));
    console.log(`INSERT INTO ${name}(${colNames}) VALUES(${vals.join(',')});`);
  }
  if (rows.length > 0) console.log(''); // newline between tables
}

db.close();
