#!/usr/bin/env node
/**
 * Import SQL dump into SQLite database.
 * Usage: NODE_PATH=/app/server/node_modules node import-db.cjs /path/to/dump.sql
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dumpPath = process.argv[2] || '/tmp/dump.sql';
const dbPath = process.env.DATABASE_PATH || '/data/data.db';

const sql = fs.readFileSync(dumpPath, 'utf8');
const db = new Database(dbPath);

// Only run INSERTs (schema already exists from app init). Split by ";\n" for statement boundaries.
const statements = sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
const inserts = statements.filter(s => /^INSERT\s/i.test(s));

db.exec('PRAGMA foreign_keys = OFF;');
let ok = 0, errs = 0;
for (const stmt of inserts) {
  if (stmt) {
    try {
      db.exec(stmt + ';');
      ok++;
    } catch (err) {
      errs++;
      console.error('Skip:', err.message);
    }
  }
}
db.exec('PRAGMA foreign_keys = ON;');
db.close();
console.log(`Import complete: ${ok} inserts, ${errs} errors.`);
