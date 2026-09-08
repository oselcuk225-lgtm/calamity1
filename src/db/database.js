'use strict';

const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL çevre değişkeni eksik — Neon connection string gir (.env veya Vercel env)');
}
const sql = neon(DATABASE_URL);

// ── Şema (Postgres / Neon) ─────────────────────────────────────────
// Ne sorulursa sorulsun: tablolar yoksa otomatik oluşturulur.
async function initSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      username    TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'user',          -- 'admin' | 'user' | 'banned'
      created_at  BIGINT NOT NULL
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS keys (
      id            SERIAL PRIMARY KEY,
      key           TEXT NOT NULL UNIQUE,
      user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      duration_type TEXT NOT NULL,                        -- 'day' | 'week' | 'month' | 'year' | 'unlimited'
      duration_value INTEGER,                             -- kaç birim
      created_at    BIGINT NOT NULL,
      activated_at  BIGINT,
      expires_at    BIGINT,
      revoked       INTEGER NOT NULL DEFAULT 0,           -- 0/1
      hwid          TEXT,
      last_seen     BIGINT
    )`;
}

// ── Yardımcılar ─────────────────────────────────────────────────────
function generateKey() {
  const seg = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `CALAMITY-${seg()}-${seg()}-${seg()}-${seg()}`;
}

const DURATION_LABELS = {
  day:       'Günlük',
  week:      'Haftalık',
  month:     'Aylık',
  year:      'Yıllık',
  unlimited: 'Sınırsız',
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function msForDuration(type, value) {
  const v = Math.max(1, value || 1);
  switch (type) {
    case 'day':   return v * 24 * 60 * 60 * 1000;
    case 'week':  return v * 7 * 24 * 60 * 60 * 1000;
    case 'month': return v * 30 * 24 * 60 * 60 * 1000;
    case 'year':  return v * 365 * 24 * 60 * 60 * 1000;
    case 'unlimited': return null;
    default:      return null;
  }
}

function computeExpiry(startSec, type, value) {
  const ms = msForDuration(type, value);
  if (ms === null) return null;
  return Math.floor((startSec * 1000 + ms) / 1000);
}

// ── Key CRUD ────────────────────────────────────────────────────────
async function createKeys({ userId, type, value, count }) {
  count = Math.max(1, count | 0 || 1);
  const t = nowSec();
  const rows = [];
  for (let i = 0; i < count; i++) {
    const k = generateKey();
    await sql`
      INSERT INTO keys (key, user_id, duration_type, duration_value, created_at)
      VALUES (${k}, ${userId ?? null}, ${type}, ${value ?? 1}, ${t})`;
    rows.push(k);
  }
  return rows;
}

async function listKeys({ userId, includeRevoked } = {}) {
  const cond = [];
  const params = [];
  if (userId) { cond.push(`user_id = $${params.length + 1}`); params.push(userId); }
  if (includeRevoked === false) { cond.push('revoked = 0'); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = await sql(`SELECT * FROM keys ${where} ORDER BY id DESC`, params);
  return rows;
}

async function listKeysWithOwner() {
  const rows = await sql(`
    SELECT k.*, u.username AS owner
    FROM keys k LEFT JOIN users u ON u.id = k.user_id
    ORDER BY k.id DESC`);
  return rows;
}

async function getKeyByString(k) {
  const rows = await sql`SELECT * FROM keys WHERE key = ${k}`;
  return rows[0] || null;
}

async function getKeyById(id) {
  const rows = await sql`SELECT * FROM keys WHERE id = ${id}`;
  return rows[0] || null;
}

async function setRevoked(id, rev) {
  await sql`UPDATE keys SET revoked = ${rev ? 1 : 0} WHERE id = ${id}`;
}

// İlk kullanımda key'i aktifleştir (hwid / sahip / süre bağla)
async function activateKey(id, { userId, hwid, nowSec, expiresAt }) {
  await sql`
    UPDATE keys
    SET activated_at = ${nowSec},
        expires_at   = ${expiresAt},
        last_seen    = ${nowSec},
        user_id      = COALESCE(user_id, ${userId}),
        hwid         = COALESCE(hwid, ${hwid})
    WHERE id = ${id}`;
}

async function touchKey(id, nowSec) {
  await sql`UPDATE keys SET last_seen = ${nowSec} WHERE id = ${id}`;
}

// ── Kullanıcı CRUD ──────────────────────────────────────────────────
async function createUser({ username, passwordHash, role = 'user' }) {
  const t = nowSec();
  const rows = await sql`
    INSERT INTO users (username, password, role, created_at)
    VALUES (${username}, ${passwordHash}, ${role}, ${t})
    RETURNING *`;
  return rows[0];
}

async function getUserByUsername(username) {
  const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
  return rows[0] || null;
}

async function getUserById(id) {
  const rows = await sql`SELECT * FROM users WHERE id = ${id}`;
  return rows[0] || null;
}

async function listUsers() {
  const rows = await sql`
    SELECT u.id, u.username, u.role, u.created_at,
           (SELECT COUNT(*) FROM keys k WHERE k.user_id = u.id) AS key_count
    FROM users u ORDER BY u.id ASC`;
  return rows;
}

async function setUserRole(id, role) {
  await sql`UPDATE users SET role = ${role} WHERE id = ${id}`;
}

async function deleteUser(id) {
  await sql`DELETE FROM users WHERE id = ${id}`;
}

// ── İstatistik ──────────────────────────────────────────────────────
async function getStats() {
  const [{ count: total }, { count: used }, { count: revoked },
         { count: users }, { count: admins }] = await Promise.all([
    sql`SELECT COUNT(*)::int AS count FROM keys`,
    sql`SELECT COUNT(*)::int AS count FROM keys WHERE activated_at IS NOT NULL`,
    sql`SELECT COUNT(*)::int AS count FROM keys WHERE revoked = 1`,
    sql`SELECT COUNT(*)::int AS count FROM users`,
    sql`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'`,
  ]);
  return { total: total ?? 0, used: used ?? 0, revoked: revoked ?? 0,
           users: users ?? 0, admins: admins ?? 0 };
}

// ── İlk admin (ENV'den) ─────────────────────────────────────────────
async function ensureFirstAdmin() {
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  if (!adminUser || !adminPass) return;
  const existing = await getUserByUsername(adminUser);
  if (existing) return;
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(adminPass, 10);
  await createUser({ username: adminUser, passwordHash: hash, role: 'admin' });
  console.log(`[db] İlk admin oluşturuldu: ${adminUser} (admin)`);
}

module.exports = {
  initSchema,
  sql,
  generateKey,
  DURATION_LABELS,
  msForDuration,
  computeExpiry,
  nowSec,
  createKeys,
  listKeys,
  listKeysWithOwner,
  getKeyByString,
  getKeyById,
  setRevoked,
  activateKey,
  touchKey,
  createUser,
  getUserByUsername,
  getUserById,
  listUsers,
  setUserRole,
  deleteUser,
  getStats,
  ensureFirstAdmin,
};