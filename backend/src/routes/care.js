import express from 'express'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { normalizeEmail, normalizePhone, normalizeRole } from '../utils/normalize.js'

const router = express.Router()
router.use(withCookies)

const MAX_ACTIVE_ELDERS = 3

const getCurrentUserWithRole = async (userId) => {
  const result = await pool.query(
    'SELECT user_id, email, phone, full_name, charactor FROM users WHERE user_id = $1 LIMIT 1',
    [userId]
  )
  if (result.rowCount === 0) return null
  const user = result.rows[0]
  const role = normalizeRole(user.charactor || '')
  return { ...user, role }
}

const ensureCaregiverUser = async (userId) => {
  const me = await getCurrentUserWithRole(userId)
  if (!me) return { error: 'not_found' }
  if (me.role === 'elder') {
    return { error: 'forbidden_role' }
  }
  const mappedRole = me.role === 'caregiver' ? 'social_worker' : 'family'
  return { user: me, mappedRole }
}

const toOwnerIdArray = (value) => {
  if (!Array.isArray(value)) return []
  return value
    .map((val) => {
      const num = Number(val)
      return Number.isFinite(num) ? num : null
    })
    .filter((val) => val !== null)
}

const ensureElderUser = async (userId) => {
  const me = await getCurrentUserWithRole(userId)
  if (!me) return { error: 'not_found' }
  if (me.role !== 'elder') return { error: 'forbidden_role' }
  return { user: me }
}

router.post('/invitations', requireAuth, async (req, res, next) => {
  try {
    const { user: caregiver, mappedRole, error } = await ensureCaregiverUser(req.userId)
    if (error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (error === 'forbidden_role') return res.status(403).json({ error: 'caregiver_only' })

    const { elderUserId, phone, email } = req.body || {}
    const elderId = Number(elderUserId)
    const phoneNorm = phone ? normalizePhone(phone) : ''
    const emailNorm = email ? normalizeEmail(email) : ''

    if (!Number.isFinite(elderId) || (!phoneNorm && !emailNorm)) {
      return res.status(400).json({ error: 'invalid_payload' })
    }
    if (elderId === caregiver.user_id) {
      return res.status(400).json({ error: 'cannot_link_self' })
    }

    const elderResult = await pool.query(
      'SELECT user_id, full_name, phone, email, charactor FROM users WHERE user_id = $1 LIMIT 1',
      [elderId]
    )
    if (elderResult.rowCount === 0) {
      return res.status(404).json({ error: 'elder_not_found' })
    }
    const elder = elderResult.rows[0]
    if (normalizeRole(elder.charactor || '') !== 'elder') {
      return res.status(400).json({ error: 'target_not_elder' })
    }

    const elderPhone = elder.phone ? normalizePhone(elder.phone) : ''
    const elderEmail = elder.email ? normalizeEmail(elder.email) : ''

    if (phoneNorm && phoneNorm !== elderPhone) {
      return res.status(400).json({ error: 'phone_mismatch' })
    }
    if (emailNorm && emailNorm !== elderEmail) {
      return res.status(400).json({ error: 'email_mismatch' })
    }

    const countActive = await pool.query(
      'SELECT COUNT(*)::int AS count FROM care_relationships WHERE caregiver_id = $1 AND status = $2',
      [caregiver.user_id, 'active']
    )
    if ((countActive.rows[0]?.count ?? 0) >= MAX_ACTIVE_ELDERS) {
      return res.status(409).json({ error: 'active_limit_reached' })
    }

    const pending = await pool.query(
      'SELECT id FROM care_invitations WHERE elder_id = $1 AND caregiver_id = $2 AND status = $3 LIMIT 1',
      [elder.user_id, caregiver.user_id, 'pending']
    )
    if (pending.rowCount > 0) {
      return res.status(409).json({ error: 'pending_exists' })
    }

    const insert = await pool.query(
      `INSERT INTO care_invitations (
         elder_id, caregiver_id, elder_user_id_snapshot, match_phone, match_email, status
       ) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, elder_id, caregiver_id, status, created_at`,
      [elder.user_id, caregiver.user_id, elder.user_id, phoneNorm || null, emailNorm || null, 'pending']
    )

    return res.status(201).json({
      invitation: {
        ...insert.rows[0],
        caregiver_role: mappedRole,
        elder: {
          user_id: elder.user_id,
          full_name: elder.full_name,
          phone: elder.phone
        }
      }
    })
  } catch (err) {
    next(err)
  }
})

router.get('/invitations', requireAuth, async (req, res, next) => {
  try {
    const direction = (req.query.direction || 'sent').toString()
    if (direction === 'received') {
      const { user: elder, error } = await ensureElderUser(req.userId)
      if (error === 'not_found') return res.status(404).json({ error: 'not_found' })
      if (error === 'forbidden_role') return res.status(403).json({ error: 'elder_only' })

      const result = await pool.query(
        `SELECT ci.id,
                ci.status,
                ci.created_at,
                ci.responded_at,
                u.user_id   AS caregiver_id,
                u.full_name AS caregiver_name,
                u.phone     AS caregiver_phone,
                u.email     AS caregiver_email,
                u.charactor AS caregiver_charactor
         FROM care_invitations ci
         JOIN users u ON u.user_id = ci.caregiver_id
         WHERE ci.elder_id = $1
           AND ci.status = 'pending'
         ORDER BY ci.created_at DESC`,
        [elder.user_id]
      )
      const invitations = result.rows.map((row) => ({
        ...row,
        caregiver_role: normalizeRole(row.caregiver_charactor || '')
      }))
      return res.json({ invitations })
    }

    const { user: caregiver, mappedRole, error } = await ensureCaregiverUser(req.userId)
    if (error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (error === 'forbidden_role') return res.status(403).json({ error: 'caregiver_only' })

    const result = await pool.query(
      `SELECT ci.id,
              ci.status,
              ci.created_at,
              ci.responded_at,
              u.user_id   AS elder_id,
              u.full_name AS elder_name,
              u.phone     AS elder_phone
       FROM care_invitations ci
       JOIN users u ON u.user_id = ci.elder_id
       WHERE ci.caregiver_id = $1
       ORDER BY ci.created_at DESC`,
      [caregiver.user_id]
    )
    return res.json({ invitations: result.rows, caregiver_role: mappedRole })
  } catch (err) {
    next(err)
  }
})

router.post('/invitations/:id/accept', requireAuth, async (req, res, next) => {
  const client = await pool.connect()
  try {
    const { user: elder, error } = await ensureElderUser(req.userId)
    if (error === 'not_found') {
      client.release()
      return res.status(404).json({ error: 'not_found' })
    }
    if (error === 'forbidden_role') {
      client.release()
      return res.status(403).json({ error: 'elder_only' })
    }

    const invitationId = Number(req.params.id)
    if (!Number.isFinite(invitationId)) {
      client.release()
      return res.status(400).json({ error: 'invalid_id' })
    }

    await client.query('BEGIN')
    const invResult = await client.query(
      `SELECT id, elder_id, caregiver_id, status
       FROM care_invitations
       WHERE id = $1
       FOR UPDATE`,
      [invitationId]
    )
    if (invResult.rowCount === 0) {
      await client.query('ROLLBACK')
      client.release()
      return res.status(404).json({ error: 'not_found' })
    }
    const inv = invResult.rows[0]
    if (inv.elder_id !== elder.user_id) {
      await client.query('ROLLBACK')
      client.release()
      return res.status(403).json({ error: 'forbidden' })
    }
    if (inv.status !== 'pending') {
      await client.query('ROLLBACK')
      client.release()
      return res.status(400).json({ error: 'not_pending' })
    }

    const countActive = await client.query(
      'SELECT COUNT(*)::int AS count FROM care_relationships WHERE caregiver_id = $1 AND status = $2',
      [inv.caregiver_id, 'active']
    )
    if ((countActive.rows[0]?.count ?? 0) >= MAX_ACTIVE_ELDERS) {
      await client.query('ROLLBACK')
      client.release()
      return res.status(409).json({ error: 'active_limit_reached' })
    }

    const relResult = await client.query(
      'SELECT id, status FROM care_relationships WHERE elder_id = $1 AND caregiver_id = $2 LIMIT 1',
      [inv.elder_id, inv.caregiver_id]
    )

    if (relResult.rowCount === 0) {
      await client.query(
        `INSERT INTO care_relationships (elder_id, caregiver_id, role, status)
         VALUES ($1,$2,$3,$4)`,
        [inv.elder_id, inv.caregiver_id, 'family', 'active']
      )
    } else if (relResult.rows[0].status !== 'active') {
      await client.query(
        'UPDATE care_relationships SET status = $1, updated_at = now() WHERE id = $2',
        ['active', relResult.rows[0].id]
      )
    }

    const ownerRes = await client.query(
      'SELECT owner_user_ids FROM users WHERE user_id = $1 FOR UPDATE',
      [inv.caregiver_id]
    )
    const rawOwnerIds = ownerRes.rows[0]?.owner_user_ids
    const ownerIds = Array.isArray(rawOwnerIds)
      ? rawOwnerIds
          .map((value) => {
            const num = Number(value)
            return Number.isFinite(num) ? num : null
          })
          .filter((num) => num !== null)
      : []
    if (!ownerIds.includes(inv.elder_id)) {
      if (ownerIds.length >= MAX_ACTIVE_ELDERS) {
        await client.query('ROLLBACK')
        client.release()
        return res.status(409).json({ error: 'owner_limit_reached' })
      }
      const nextOwnerIds = [...ownerIds, inv.elder_id]
      await client.query(
        'UPDATE users SET owner_user_ids = $1, updated_at = now() WHERE user_id = $2',
        [nextOwnerIds, inv.caregiver_id]
      )
    }

    const nowIso = new Date().toISOString()
    const title = `${elder.full_name || '長者'} 已同意您的關注邀請`
    await client.query(
      `INSERT INTO user_events (
         user_id, owner_user_id, title, description,
         start_time, end_time, reminder_time, location,
         is_all_day, recurrence_rule, recurrence_end_date,
         category, status
       ) VALUES (
         $1,$2,$3,$4,
         $5,$6,$7,$8,
         $9,$10,$11,$12,
         $13
       )`,
      [
        inv.caregiver_id,
        inv.elder_id,
        title,
        null,
        nowIso,
        nowIso,
        nowIso,
        null,
        false,
        null,
        null,
        'care_invitation',
        true
      ]
    )

    const updatedInv = await client.query(
      `UPDATE care_invitations
       SET status = $1,
           responded_at = now()
       WHERE id = $2
       RETURNING id, elder_id, caregiver_id, status, created_at, responded_at`,
      ['accepted', invitationId]
    )

    await client.query('COMMIT')
    client.release()
    return res.json({ invitation: updatedInv.rows[0] })
  } catch (err) {
    try {
      await pool.query('ROLLBACK')
    } catch (_) {}
    next(err)
  }
})

router.post('/invitations/:id/reject', requireAuth, async (req, res, next) => {
  try {
    const { user: elder, error } = await ensureElderUser(req.userId)
    if (error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (error === 'forbidden_role') return res.status(403).json({ error: 'elder_only' })

    const invitationId = Number(req.params.id)
    if (!Number.isFinite(invitationId)) return res.status(400).json({ error: 'invalid_id' })

    const result = await pool.query(
      `UPDATE care_invitations
       SET status = $1,
           responded_at = now()
       WHERE id = $2 AND elder_id = $3 AND status = $4
       RETURNING id, elder_id, caregiver_id, status, created_at, responded_at`,
      ['rejected', invitationId, elder.user_id, 'pending']
    )
    if (result.rowCount === 0) return res.status(404).json({ error: 'not_found' })

    const inv = result.rows[0]
    const nowIso = new Date().toISOString()
    const title = `${elder.full_name || '長者'} 已拒絕您的關注邀請`
    await pool.query(
      `INSERT INTO user_events (
         user_id, owner_user_id, title, description,
         start_time, end_time, reminder_time, location,
         is_all_day, recurrence_rule, recurrence_end_date,
         category, status
       ) VALUES (
         $1,$2,$3,$4,
         $5,$6,$7,$8,
         $9,$10,$11,$12,
         $13
       )`,
      [
        inv.caregiver_id,
        inv.elder_id,
        title,
        null,
        nowIso,
        nowIso,
        nowIso,
        null,
        false,
        null,
        null,
        'care_invitation',
        true
      ]
    )

    return res.json({ invitation: result.rows[0] })
  } catch (err) {
    next(err)
  }
})

router.get('/elders', requireAuth, async (req, res, next) => {
  try {
    const { user: caregiver, mappedRole, error } = await ensureCaregiverUser(req.userId)
    if (error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (error === 'forbidden_role') return res.status(403).json({ error: 'caregiver_only' })

    const result = await pool.query(
      `SELECT r.id,
              r.status,
              u.user_id,
              u.full_name,
              u.age,
              u.phone,
              u.address
       FROM care_relationships r
       JOIN users u ON u.user_id = r.elder_id
       WHERE r.caregiver_id = $1 AND r.status = $2
       ORDER BY u.full_name NULLS LAST, u.user_id ASC`,
      [caregiver.user_id, 'active']
    )
    let elders = result.rows

    // 舊版資料以 users.owner_user_ids 儲存，若 care_relationships 沒資料，改用 owner_user_ids 回填。
    if (!elders.length) {
      const ownerRes = await pool.query(
        'SELECT owner_user_ids FROM users WHERE user_id = $1 LIMIT 1',
        [caregiver.user_id]
      )
      const ownerIds = toOwnerIdArray(ownerRes.rows[0]?.owner_user_ids)
      if (ownerIds.length) {
        const fallback = await pool.query(
          `SELECT u.user_id, u.full_name, u.age, u.phone, u.address
           FROM unnest($1::int[]) WITH ORDINALITY AS t(id, ord)
           JOIN users u ON u.user_id = t.id
           ORDER BY t.ord`,
          [ownerIds]
        )
        elders = fallback.rows
      }
    }

    return res.json({ elders, caregiver_role: mappedRole })
  } catch (err) {
    next(err)
  }
})

router.get('/caregivers', requireAuth, async (req, res, next) => {
  try {
    const { user: elder, error } = await ensureElderUser(req.userId)
    if (error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (error === 'forbidden_role') return res.status(403).json({ error: 'elder_only' })

    const result = await pool.query(
      `SELECT r.id,
              r.status,
              r.role,
              u.user_id,
              u.full_name,
              u.phone,
              u.email
       FROM care_relationships r
       JOIN users u ON u.user_id = r.caregiver_id
       WHERE r.elder_id = $1 AND r.status = $2
       ORDER BY r.created_at ASC`,
      [elder.user_id, 'active']
    )
    return res.json({ caregivers: result.rows })
  } catch (err) {
    next(err)
  }
})

router.get('/elders/:elderId/events', requireAuth, async (req, res, next) => {
  try {
    const elderId = Number(req.params.elderId)
    if (!Number.isFinite(elderId)) {
      return res.status(400).json({ error: 'invalid_elder_id' })
    }

    const { user: caregiver, error } = await ensureCaregiverUser(req.userId)
    if (error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (error === 'forbidden_role') return res.status(403).json({ error: 'caregiver_only' })

    const rel = await pool.query(
      'SELECT 1 FROM care_relationships WHERE caregiver_id = $1 AND elder_id = $2 AND status = $3 LIMIT 1',
      [caregiver.user_id, elderId, 'active']
    )
    if (rel.rowCount === 0) {
      return res.status(403).json({ error: 'no_relationship' })
    }

    const dateStr = (req.query.date || '').toString().slice(0, 10)
    let from = null
    let to = null
    if (dateStr) {
      const d = new Date(`${dateStr}T00:00:00`)
      if (!Number.isNaN(d.getTime())) {
        from = d.toISOString()
        const d2 = new Date(d.getTime() + 24 * 60 * 60 * 1000)
        to = d2.toISOString()
      }
    }

    const sql = `
      SELECT id, user_id, owner_user_id, title, description,
             start_time, end_time, reminder_time, location,
             is_all_day, recurrence_rule, recurrence_end_date,
             category, status, created_at, updated_at
      FROM user_events
      WHERE user_id = $3
        AND ($1::timestamptz IS NULL OR start_time >= $1::timestamptz)
        AND ($2::timestamptz IS NULL OR start_time <  $2::timestamptz)
      ORDER BY start_time ASC, id ASC`

    const result = await pool.query(sql, [from, to, elderId])
    return res.json({ events: result.rows })
  } catch (err) {
    next(err)
  }
})

router.post('/elders/:elderId/events/bulk', requireAuth, async (req, res, next) => {
  try {
    const elderId = Number(req.params.elderId)
    if (!Number.isFinite(elderId)) {
      return res.status(400).json({ error: 'invalid_elder_id' })
    }

    const { user: caregiver, error } = await ensureCaregiverUser(req.userId)
    if (error === 'not_found') return res.status(404).json({ error: 'not_found' })
    if (error === 'forbidden_role') return res.status(403).json({ error: 'caregiver_only' })

    const rel = await pool.query(
      'SELECT 1 FROM care_relationships WHERE caregiver_id = $1 AND elder_id = $2 AND status = $3 LIMIT 1',
      [caregiver.user_id, elderId, 'active']
    )
    if (rel.rowCount === 0) {
      return res.status(403).json({ error: 'no_relationship' })
    }

    const {
      title,
      description,
      category,
      start_date,
      days,
      time,
      remind_time: remindTime
    } = req.body || {}

    if (!title || !start_date || !time) {
      return res.status(400).json({ error: 'invalid_payload' })
    }

    const totalDays = Number(days) || 0
    if (!Number.isFinite(totalDays) || totalDays <= 0 || totalDays > 60) {
      return res.status(400).json({ error: 'invalid_days' })
    }

    const base = new Date(`${start_date}T${time}:00+08:00`)
    if (Number.isNaN(base.getTime())) {
      return res.status(400).json({ error: 'invalid_start_date' })
    }

    let baseRemind = null
    if (remindTime) {
      const r = new Date(`${start_date}T${remindTime}:00+08:00`)
      if (!Number.isNaN(r.getTime())) baseRemind = r
    }

    const results = []
    const dayMs = 24 * 60 * 60 * 1000

    for (let i = 0; i < totalDays; i++) {
      const start = new Date(base.getTime() + i * dayMs)
      const end = new Date(start.getTime())
      const remind = baseRemind
        ? new Date(baseRemind.getTime() + i * dayMs)
        : new Date(start.getTime())

      const sql = `
        INSERT INTO user_events (
          user_id, owner_user_id, title, description,
          start_time, end_time, reminder_time, location,
          is_all_day, recurrence_rule, recurrence_end_date,
          category, status
        ) VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,$8,
          $9,$10,$11,$12,
          $13
        )
        RETURNING id, user_id, owner_user_id, title, description,
                  start_time, end_time, reminder_time, location,
                  is_all_day, recurrence_rule, recurrence_end_date,
                  category, status, created_at, updated_at`

      const values = [
        elderId,
        caregiver.user_id,
        title,
        description ?? null,
        start.toISOString(),
        end.toISOString(),
        remind.toISOString(),
        null,
        false,
        null,
        null,
        category ?? null,
        false
      ]

      const inserted = await pool.query(sql, values)
      if (inserted.rowCount > 0) results.push(inserted.rows[0])
    }

    return res.status(201).json({ events: results })
  } catch (err) {
    next(err)
  }
})

export default router
