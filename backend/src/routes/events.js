import express from 'express'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'

const router = express.Router()
router.use(withCookies)

const parseTs = (v) => {
  if (!v) return null
  try {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return null
    return d.toISOString()
  } catch {
    return null
  }
}

// GET /api/events?from&to  — 只回傳呼叫者相關的事件（user_id 或 owner_user_id = 自己）
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const from = parseTs(req.query.from)
    const to = parseTs(req.query.to)
    try { console.log('[events.list] uid=%s from=%s to=%s', req.userId, from, to) } catch {}

    const sql = `
      SELECT id, user_id, owner_user_id, title, description,
             start_time, end_time, reminder_time, location,
             is_all_day, recurrence_rule, recurrence_end_date,
             category, status, created_at, updated_at
      FROM user_events
      WHERE (user_id = $3 OR owner_user_id = $3)
        AND ($1::timestamptz IS NULL OR start_time >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR start_time <  $2::timestamptz)
      ORDER BY start_time ASC, id ASC`
    const result = await pool.query(sql, [from, to, req.userId])
    return res.json({ events: result.rows })
  } catch (error) {
    next(error)
  }
})

// POST /api/events  — 建立事件（owner 預設為自己，user_id 未帶則為自己）
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      user_id,
      title,
      description,
      start_time,
      end_time,
      reminder_time,
      location,
      is_all_day,
      recurrence_rule,
      recurrence_end_date,
      category,
      status
    } = req.body || {}

    if (!title || !start_time) return res.status(400).json({ error: 'invalid_payload' })

    const subjectUserId = Number.isFinite(Number(user_id)) ? Number(user_id) : req.userId
    const ownerUserId = req.userId

    const sql = `
      INSERT INTO user_events (
        user_id, owner_user_id, title, description, start_time, end_time, reminder_time,
        location, is_all_day, recurrence_rule, recurrence_end_date, category, status
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,
        $8,$9,$10,$11,$12,$13
      )
      RETURNING *`

    const values = [
      subjectUserId,
      ownerUserId,
      title,
      description ?? null,
      start_time,
      end_time ?? null,
      reminder_time ?? null,
      location ?? null,
      !!is_all_day,
      recurrence_rule ?? null,
      recurrence_end_date ?? null,
      category ?? null,
      !!status
    ]

    const result = await pool.query(sql, values)
    try { console.log('[events.create] uid=%s created id=%s', req.userId, result.rows[0]?.id ?? null) } catch {}
    return res.status(201).json({ event: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/events/:id — 僅事件相關人可改
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' })

    const check = await pool.query('SELECT user_id, owner_user_id FROM user_events WHERE id=$1', [id])
    if (check.rowCount === 0) return res.status(404).json({ error: 'not_found' })
    const evt = check.rows[0]
    if (evt.user_id !== req.userId && evt.owner_user_id !== req.userId) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const allowed = ['title','description','start_time','end_time','reminder_time','location','is_all_day','recurrence_rule','recurrence_end_date','category','status']
    const fields = []
    const values = []
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        fields.push(`${key} = $${fields.length + 1}`)
        values.push(req.body[key])
      }
    }
    if (fields.length === 0) return res.status(400).json({ error: 'invalid_payload' })

    const sql = `UPDATE user_events SET ${fields.join(', ')}, updated_at = now() WHERE id = $${fields.length + 1} RETURNING *`
    values.push(id)
    const result = await pool.query(sql, values)
    try { console.log('[events.update] uid=%s updated id=%s', req.userId, id) } catch {}
    return res.json({ event: result.rows[0] })
  } catch (error) {
    next(error)
  }
})

// DELETE /api/events/:id
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' })
    const check = await pool.query('SELECT user_id, owner_user_id FROM user_events WHERE id=$1', [id])
    if (check.rowCount === 0) return res.status(404).json({ error: 'not_found' })
    const evt = check.rows[0]
    if (evt.user_id !== req.userId && evt.owner_user_id !== req.userId) {
      return res.status(403).json({ error: 'forbidden' })
    }
    await pool.query('DELETE FROM user_events WHERE id=$1', [id])
    try { console.log('[events.delete] uid=%s deleted id=%s', req.userId, id) } catch {}
    return res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

export default router

