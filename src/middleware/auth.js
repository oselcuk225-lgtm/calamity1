'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = process.env.JWT_EXPIRY || '7d';

if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET env set edilmedi! Vercel\'de token kalıcılığı için ayarla.');
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

function authUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Giriş yapılmamış (token yok)' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'Oturum geçersiz ya da süresi dolmuş' });
  }
}

function authAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, error: 'Giriş gerekli' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Yetkisiz: yalnızca admin' });
  }
  next();
}

module.exports = { JWT_SECRET, JWT_EXPIRY, signToken, authUser, authAdmin };