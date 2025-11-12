import express from 'express'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { normalizePhone, normalizeRole } from '../utils/normalize.js'

const router = express.Router()
router.use(withCookies)

const FRIEND_LIMIT = 10
const STATUS = {
  pending: 'pending',
  accepted: 'accepted',
  declined: 'declined',
  cancelled: 'cancelled'
}

const fetchBasicUser = async (userId) => {
  if (!Number.isFinite(userId)) return null
  const { rows } = await pool.query(
    'SELECT user_id, full_name, username, phone, charactor FROM users WHERE user_id = $1 LIMIT 1',
    [userId]
  )
  return rows[0] ?? null
}

const ensureElder = (user) => normalizeRole(user?.charactor || '') === 'elder'

const countAcceptedFriends = async (userId) => {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM elder_friendships
     WHERE status = $1 AND (requester_id = $2 OR addressee_id = $2)`,
    [STATUS.accepted, userId]
  )
  return rows[0]?.total ?? 0
}

const hasExistingEdge = async (a, b) => {
  const { rows } = await pool.query(
    `SELECT friendship_id, status, requester_id, addressee_id
     FROM elder_friendships
     WHERE (requester_id = $1 AND addressee_id = $2)
        OR (requester_id = $2 AND addressee_id = $1)
     LIMIT 1`,
    [a, b]
  )
  return rows[0] ?? null
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.friendship_id,
              f.created_at,
              f.updated_at,
              u.user_id,
              u.full_name,
              u.username,
              u.phone
       FROM elder_friendships f
       JOIN users u
         ON u.user_id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = $2
       ORDER BY u.full_name NULLS LAST, u.user_id ASC`,
      [req.userId, STATUS.accepted]
    )
    res.json({ friends: rows })
  } catch (error) {
    next(error)
  }
})

router.get('/requests', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.friendship_id,
              f.created_at,
              f.requester_id,
              f.addressee_id,
              (f.requester_id = $1) AS is_requester,
              u.user_id,
              u.full_name,
              u.username,
              u.phone
       FROM elder_friendships f
       JOIN users u
         ON u.user_id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = $2
       ORDER BY f.created_at ASC`,
      [req.userId, STATUS.pending]
    )

    const incoming = rows.filter((row) => !row.is_requester)
    const sent = rows.filter((row) => row.is_requester)
    res.json({ incoming, sent })
  } catch (error) {
    next(error)
  }
})

router.post('/requests', requireAuth, async (req, res, next) => {
  try {
    const normalizedPhone = normalizePhone(req.body?.phone)
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'invalid_phone' })
    }

    const current = await fetchBasicUser(req.userId)
    if (!current || !ensureElder(current)) {
      return res.status(403).json({ error: 'only_elders_can_invite' })
    }

    const target = await pool.query(
      'SELECT user_id, full_name, username, phone, charactor FROM users WHERE phone = $1 LIMIT 1',
      [normalizedPhone]
    )
    if (target.rowCount === 0) {
      return res.status(404).json({ error: 'elder_not_found' })
    }

    const elder = target.rows[0]
    if (!ensureElder(elder)) {
      return res.status(400).json({ error: 'target_not_elder' })
    }
    if (elder.user_id === req.userId) {
      return res.status(400).json({ error: 'cannot_add_self' })
    }

    const existing = await hasExistingEdge(req.userId, elder.user_id)
    if (existing) {
      if (existing.status === STATUS.pending) {
        return res.status(409).json({ error: 'request_exists' })
      }
      if (existing.status === STATUS.accepted) {
        return res.status(409).json({ error: 'already_friends' })
      }
    }

    const [requesterCount, targetCount] = await Promise.all([
      countAcceptedFriends(req.userId),
      countAcceptedFriends(elder.user_id)
    ])
    if (requesterCount >= FRIEND_LIMIT || targetCount >= FRIEND_LIMIT) {
      return res.status(409).json({ error: 'friend_limit_reached' })
    }

    if (existing && existing.status !== STATUS.pending && existing.status !== STATUS.accepted) {
      const refreshed = await pool.query(
        `UPDATE elder_friendships
         SET requester_id = $1,
             addressee_id = $2,
             status = $3,
             responded_at = NULL,
             created_at = now(),
             updated_at = now()
         WHERE friendship_id = $4
         RETURNING created_at`,
        [req.userId, elder.user_id, STATUS.pending, existing.friendship_id]
      )
      return res.json({
        request: {
          friendship_id: existing.friendship_id,
          created_at: refreshed.rows[0]?.created_at ?? new Date().toISOString(),
          requester_id: req.userId,
          addressee_id: elder.user_id,
          elder: {
            user_id: elder.user_id,
            full_name: elder.full_name,
            username: elder.username,
            phone: elder.phone
          }
        }
      })
    }

    const insert = await pool.query(
      `INSERT INTO elder_friendships (requester_id, addressee_id, status)
       VALUES ($1, $2, $3)
       RETURNING friendship_id, created_at`,
      [req.userId, elder.user_id, STATUS.pending]
    )

    return res.status(201).json({
      request: {
        friendship_id: insert.rows[0].friendship_id,
        created_at: insert.rows[0].created_at,
        requester_id: req.userId,
        addressee_id: elder.user_id,
        elder: {
          user_id: elder.user_id,
          full_name: elder.full_name,
          username: elder.username,
          phone: elder.phone
        }
      }
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/requests/:id', requireAuth, async (req, res, next) => {
  try {
    const friendshipId = Number(req.params.id)
    if (!Number.isFinite(friendshipId)) {
      return res.status(400).json({ error: 'invalid_id' })
    }
    const action = String(req.body?.action || '').toLowerCase()
    if (!['accept', 'decline', 'cancel'].includes(action)) {
      return res.status(400).json({ error: 'invalid_action' })
    }

    const { rows } = await pool.query(
      'SELECT friendship_id, requester_id, addressee_id, status FROM elder_friendships WHERE friendship_id = $1 LIMIT 1',
      [friendshipId]
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: 'not_found' })
    }
    const request = rows[0]
    if (request.status !== STATUS.pending) {
      return res.status(400).json({ error: 'request_closed' })
    }

    if (action === 'cancel') {
      if (request.requester_id !== req.userId) {
        return res.status(403).json({ error: 'forbidden' })
      }
      await pool.query(
        'UPDATE elder_friendships SET status = $1, responded_at = now(), updated_at = now() WHERE friendship_id = $2',
        [STATUS.cancelled, friendshipId]
      )
      return res.json({ status: STATUS.cancelled })
    }

    if (request.addressee_id !== req.userId) {
      return res.status(403).json({ error: 'forbidden' })
    }

    if (action === 'accept') {
      const [acceptorCount, requesterCount] = await Promise.all([
        countAcceptedFriends(request.addressee_id),
        countAcceptedFriends(request.requester_id)
      ])
      if (acceptorCount >= FRIEND_LIMIT || requesterCount >= FRIEND_LIMIT) {
        return res.status(409).json({ error: 'friend_limit_reached' })
      }
      await pool.query(
        'UPDATE elder_friendships SET status = $1, responded_at = now(), updated_at = now() WHERE friendship_id = $2',
        [STATUS.accepted, friendshipId]
      )
      return res.json({ status: STATUS.accepted })
    }

    await pool.query(
      'UPDATE elder_friendships SET status = $1, responded_at = now(), updated_at = now() WHERE friendship_id = $2',
      [STATUS.declined, friendshipId]
    )
    return res.json({ status: STATUS.declined })
  } catch (error) {
    next(error)
  }
})

export default router
