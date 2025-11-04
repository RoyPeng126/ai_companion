import express from 'express'
import jwt from 'jsonwebtoken'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { changePasswordLimiter } from '../middleware/limiters.js'

const router = express.Router()

// Ensure cookie parsing for this router
router.use(cookieParser())
router.use(withCookies)

const COOKIE_NAME = 'ai_auth'
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days

const signToken = (payload) => {
  const secret = process.env.JWT_SECRET || 'dev_secret_change_me'
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL_SECONDS })
}

const verifyToken = (token) => {
  const secret = process.env.JWT_SECRET || 'dev_secret_change_me'
  return jwt.verify(token, secret)
}

const setAuthCookie = (res, token) => {
  const isProd = process.env.NODE_ENV === 'production'
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd, // only over HTTPS in production
    sameSite: isProd ? 'lax' : 'lax',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/'
  })
}

const clearAuthCookie = (res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' })
}

const normalizeEmail = (email = '') => String(email).trim().toLowerCase()

// Normalize UI role value to DB stored charactor
// elder | family | caregiver
const normalizeRole = (role = '') => {
  const r = String(role).trim().toLowerCase()
  if (r === 'grandpa' || r === 'grandma' || r === 'senior' || r === 'elder') return 'elder'
  if (r === 'family') return 'family'
  if (r === 'social-worker' || r === 'caregiver') return 'caregiver'
  return ''
}

// POST /api/auth/register
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, username, full_name, age, owner_user_id, relation, phone, address } = req.body || {}
    // Accept role from multiple sources: body.charactor, body.role, or query.role
    const rawRole = req.body?.charactor ?? req.body?.role ?? req.query?.role
    const charactor = normalizeRole(rawRole)

    const normEmail = normalizeEmail(email)
    if (!normEmail || !password) {
      return res.status(400).json({ error: '缺少必要欄位' })
    }
    try { console.log('[auth.register] email=%s role(raw)=%s normalized=%s', normEmail, rawRole ?? null, charactor || null) } catch (_) {}

    // Check duplicate
    const dup = await pool.query(
      'SELECT 1 FROM users WHERE lower(email) = $1 OR username = $2 LIMIT 1',
      [normEmail, username || null]
    )
    if (dup.rowCount > 0) {
      return res.status(409).json({ error: '帳號已存在' })
    }

    const hash = await bcrypt.hash(password, 10)

    const insert = await pool.query(
      `INSERT INTO users (username, email, password_hash, owner_user_id, relation, full_name, age, phone, address, charactor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING user_id, email, username, full_name, charactor`,
      [
        username || normEmail.split('@')[0],
        normEmail,
        hash,
        owner_user_id ?? null,
        relation ?? null,
        full_name ?? null,
        Number.isFinite(Number(age)) ? Number(age) : null,
        phone ?? null,
        address ?? null,
        charactor || null
      ]
    )

    const user = insert.rows[0]
    try { console.log('[auth.register] inserted user_id=%s charactor=%s', user?.user_id ?? null, (user?.charactor ?? '').toString().trim() || null) } catch (_) {}
    // Auto login on register (optional). Here we return success and let UI redirect to login.
    return res.status(201).json({ user })
  } catch (error) {
    next(error)
  }
})

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {}
    // Accept role from body.role, body.charactor, or query.role
    const loginRole = normalizeRole((req.body?.role ?? req.body?.charactor ?? req.query?.role) || '')
    const normEmail = normalizeEmail(email)
    if (!normEmail || !password) {
      return res.status(400).json({ error: '缺少必要欄位' })
    }

    const result = await pool.query(
      'SELECT user_id, email, username, full_name, password_hash, charactor FROM users WHERE lower(email) = $1 LIMIT 1',
      [normEmail]
    )

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }

    const user = result.rows[0]
    const ok = await bcrypt.compare(password, user.password_hash || '')
    if (!ok) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }

    // Enforce role match only if DB has charactor set
    const userRole = (user.charactor || '').toString().trim()
    if (userRole) {
      if (!loginRole || loginRole !== normalizeRole(userRole)) {
        try { console.warn('[auth.login] role mismatch email=%s db=%s login=%s', user.email, userRole, loginRole) } catch (_) {}
        return res.status(401).json({ error: 'invalid_credentials' })
      }
    } else {
      try { console.log('[auth.login] no charactor set for email=%s (compat allow)', user.email) } catch (_) {}
    }

    const token = signToken({ uid: user.user_id })
    setAuthCookie(res, token)

    return res.json({ user: { user_id: user.user_id, email: user.email, username: user.username, full_name: user.full_name } })
  } catch (error) {
    next(error)
  }
})

// GET /api/auth/me
router.get('/me', async (req, res, next) => {
  try {
    const token = req.cookies?.[COOKIE_NAME]
    if (!token) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    let payload
    try {
      payload = verifyToken(token)
    } catch {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const result = await pool.query(
      'SELECT user_id, email, username, full_name FROM users WHERE user_id = $1 LIMIT 1',
      [payload.uid]
    )
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    return res.json({ user: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearAuthCookie(res)
  res.json({ ok: true })
})

export default router

// Extra: change password endpoint
router.post('/change-password', changePasswordLimiter, requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {}
    if (!currentPassword || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'invalid_payload' })
    }
    const result = await pool.query('SELECT password_hash FROM users WHERE user_id = $1 LIMIT 1', [req.userId])
    if (result.rowCount === 0) return res.status(401).json({ error: 'unauthorized' })
    const ok = await bcrypt.compare(currentPassword, result.rows[0].password_hash || '')
    if (!ok) return res.status(403).json({ error: 'wrong_password' })
    const hash = await bcrypt.hash(newPassword, 10)
    await pool.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE user_id=$2', [hash, req.userId])
    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})
