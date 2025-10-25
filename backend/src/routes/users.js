import express from 'express'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { updateProfileLimiter } from '../middleware/limiters.js'

const router = express.Router()
router.use(withCookies)

const normalizeEmail = (email = '') => String(email).trim().toLowerCase()

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT user_id, email, username, full_name, age, phone, address FROM users WHERE user_id = $1 LIMIT 1',
      [req.userId]
    )
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' })
    return res.json({ user: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

router.patch('/me', updateProfileLimiter, requireAuth, async (req, res, next) => {
  try {
    const { email, username, full_name, age, phone, address } = req.body || {}

    // Uniqueness checks
    if (email) {
      const e = normalizeEmail(email)
      const dup = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1) AND user_id<>$2 LIMIT 1', [e, req.userId])
      if (dup.rowCount > 0) return res.status(409).json({ error: 'email_taken' })
    }
    if (username) {
      const dup = await pool.query('SELECT 1 FROM users WHERE username=$1 AND user_id<>$2 LIMIT 1', [username, req.userId])
      if (dup.rowCount > 0) return res.status(409).json({ error: 'username_taken' })
    }

    // Build dynamic SET
    const fields = []
    const values = []
    const pushField = (col, val) => { fields.push(`${col} = $${fields.length + 1}`); values.push(val) }

    if (email !== undefined) pushField('email', normalizeEmail(email))
    if (username !== undefined) pushField('username', username)
    if (full_name !== undefined) pushField('full_name', full_name)
    if (age !== undefined) pushField('age', Number.isFinite(Number(age)) ? Number(age) : null)
    if (phone !== undefined) pushField('phone', phone)
    if (address !== undefined) pushField('address', address)

    if (fields.length === 0) return res.status(400).json({ error: 'invalid_payload' })

    const sql = `UPDATE users SET ${fields.join(', ')}, updated_at = now() WHERE user_id = $${fields.length + 1}
                 RETURNING user_id, email, username, full_name, age, phone, address`
    values.push(req.userId)

    const result = await pool.query(sql, values)
    return res.json({ user: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

export default router
