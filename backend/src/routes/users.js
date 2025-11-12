import express from 'express'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { updateProfileLimiter } from '../middleware/limiters.js'
import { normalizeEmail, normalizePhone, normalizeRole } from '../utils/normalize.js'

const router = express.Router()
router.use(withCookies)

const MAX_OWNER_IDS = 3

const toOwnerIdArray = (value) => {
  if (!Array.isArray(value)) return []
  return value.map(Number).filter((id) => Number.isFinite(id))
}

const fetchEldersByIds = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const { rows } = await pool.query(
    `SELECT u.user_id, u.full_name, u.username, u.phone
     FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)
     JOIN users u ON u.user_id = t.id
     ORDER BY t.ord`,
    [ids]
  )
  return rows
}

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT user_id, email, username, full_name, age, phone, address, owner_user_ids, charactor FROM users WHERE user_id = $1 LIMIT 1',
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

    if (email) {
      const e = normalizeEmail(email)
      const dup = await pool.query('SELECT 1 FROM users WHERE lower(email)=lower($1) AND user_id<>$2 LIMIT 1', [e, req.userId])
      if (dup.rowCount > 0) return res.status(409).json({ error: 'email_taken' })
    }
    if (username) {
      const dup = await pool.query('SELECT 1 FROM users WHERE username=$1 AND user_id<>$2 LIMIT 1', [username, req.userId])
      if (dup.rowCount > 0) return res.status(409).json({ error: 'username_taken' })
    }
    let nextPhoneValue
    if (phone !== undefined) {
      const trimmed = String(phone ?? '').trim()
      if (trimmed) {
        const normalized = normalizePhone(trimmed)
        if (!normalized) return res.status(400).json({ error: 'invalid_phone' })
        const dup = await pool.query('SELECT 1 FROM users WHERE phone=$1 AND user_id<>$2 LIMIT 1', [normalized, req.userId])
        if (dup.rowCount > 0) return res.status(409).json({ error: 'phone_taken' })
        nextPhoneValue = normalized
      } else {
        nextPhoneValue = null
      }
    }

    // Build dynamic SET
    const fields = []
    const values = []
    const pushField = (col, val) => { fields.push(`${col} = $${fields.length + 1}`); values.push(val) }

    if (email !== undefined) pushField('email', normalizeEmail(email))
    if (username !== undefined) pushField('username', username)
    if (full_name !== undefined) pushField('full_name', full_name)
    if (age !== undefined) pushField('age', Number.isFinite(Number(age)) ? Number(age) : null)
    if (phone !== undefined) pushField('phone', nextPhoneValue ?? null)
    if (address !== undefined) pushField('address', address)

    if (fields.length === 0) return res.status(400).json({ error: 'invalid_payload' })

    const sql = `UPDATE users SET ${fields.join(', ')}, updated_at = now() WHERE user_id = $${fields.length + 1}
                 RETURNING user_id, email, username, full_name, age, phone, address, owner_user_ids, charactor`
    values.push(req.userId)

    const result = await pool.query(sql, values)
    return res.json({ user: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

router.get('/linked-elder', requireAuth, async (req, res, next) => {
  try {
    const current = await pool.query(
      'SELECT owner_user_ids FROM users WHERE user_id = $1 LIMIT 1',
      [req.userId]
    )
    if (current.rowCount === 0) return res.status(404).json({ error: 'not_found' })
    const ownerIds = toOwnerIdArray(current.rows[0].owner_user_ids)
    if (!ownerIds.length) {
      return res.json({ elders: [] })
    }
    const elders = await fetchEldersByIds(ownerIds)
    return res.json({ elders })
  } catch (error) {
    next(error)
  }
})

router.post('/link-elder', requireAuth, async (req, res, next) => {
  try {
    const { elder_user_id, elder_phone } = req.body || {}
    const elderId = Number(elder_user_id)
    const normalizedPhone = normalizePhone(elder_phone)
    if (!Number.isFinite(elderId) || !normalizedPhone) {
      return res.status(400).json({ error: 'invalid_payload' })
    }
    if (elderId === req.userId) {
      return res.status(400).json({ error: 'cannot_link_self' })
    }

    const current = await pool.query(
      'SELECT user_id, owner_user_ids, charactor FROM users WHERE user_id = $1 LIMIT 1',
      [req.userId]
    )
    if (current.rowCount === 0) return res.status(404).json({ error: 'not_found' })
    const currentRole = normalizeRole(current.rows[0].charactor || '')
    if (currentRole === 'elder') {
      return res.status(403).json({ error: 'elders_cannot_link_owner' })
    }
    const currentOwnerIds = toOwnerIdArray(current.rows[0].owner_user_ids)
    if (currentOwnerIds.includes(elderId)) {
      const elders = await fetchEldersByIds(currentOwnerIds)
      return res.json({ elders })
    }
    if (currentOwnerIds.length >= MAX_OWNER_IDS) {
      return res.status(409).json({ error: 'owner_limit_reached' })
    }

    const elder = await pool.query(
      `SELECT user_id, full_name, username, phone, charactor
       FROM users
       WHERE user_id = $1 AND phone = $2
       LIMIT 1`,
      [elderId, normalizedPhone]
    )
    if (elder.rowCount === 0) {
      return res.status(404).json({ error: 'elder_not_found' })
    }

    const elderRow = elder.rows[0]
    if (normalizeRole(elderRow.charactor || '') !== 'elder') {
      return res.status(400).json({ error: 'target_not_elder' })
    }

    const updatedOwnerIds = [...currentOwnerIds, elderId]
    await pool.query(
      'UPDATE users SET owner_user_ids = $1, updated_at = now() WHERE user_id = $2',
      [updatedOwnerIds, req.userId]
    )
    const elders = await fetchEldersByIds(updatedOwnerIds)
    return res.json({ elders })
  } catch (error) {
    next(error)
  }
})

export default router
