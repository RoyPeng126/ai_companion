import express from 'express'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { normalizeRole } from '../utils/normalize.js'

const router = express.Router()
router.use(withCookies)

const PARTICIPANT_STATUS = {
  invited: 'invited',
  going: 'going',
  declined: 'declined'
}

const TAIPEI_TZ = 'Asia/Taipei'
const sameDayInTaipei = (a, b) => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TAIPEI_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
  return fmt.format(a) === fmt.format(b)
}

const ensureTaipeiDate = (value) => {
  if (!value) return null
  const text = String(value).trim()
  if (!text) return null
  const hasTime = text.includes('T')
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(text)
  let candidate = text
  if (!hasZone) {
    candidate = hasTime ? `${text}:00+08:00` : `${text}T00:00:00+08:00`
  }
  const date = new Date(candidate)
  if (Number.isNaN(date.getTime())) return null
  return date
}

const fetchViewer = async (userId) => {
  const { rows } = await pool.query(
    'SELECT user_id, charactor FROM users WHERE user_id = $1 LIMIT 1',
    [userId]
  )
  return rows[0] ?? null
}

const ensureElder = async (userId) => {
  const viewer = await fetchViewer(userId)
  if (!viewer || normalizeRole(viewer.charactor || '') !== 'elder') {
    return null
  }
  return viewer
}

const fetchFriendIds = async (userId) => {
  const { rows } = await pool.query(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
     FROM elder_friendships
     WHERE status = 'accepted'
       AND (requester_id = $1 OR addressee_id = $1)`,
    [userId]
  )
  return rows.map((row) => row.friend_id)
}

const fetchEventForViewer = async (eventId, viewerId) => {
  const { rows } = await pool.query(
    `SELECT e.event_id,
            e.host_user_id,
            e.title,
            e.description,
            e.start_time,
            e.location,
            e.created_at,
            json_build_object(
              'user_id', host.user_id,
              'full_name', host.full_name,
              'username', host.username,
              'phone', host.phone
            ) AS host,
            viewer.status AS viewer_status,
            COALESCE(
              json_agg(
                json_build_object(
                  'user_id', p.user_id,
                  'status', p.status,
                  'full_name', u.full_name,
                  'username', u.username
                )
                ORDER BY p.created_at ASC
              ) FILTER (WHERE p.user_id IS NOT NULL),
              '[]'
            ) AS participants
     FROM elder_friend_events e
     JOIN users host ON host.user_id = e.host_user_id
     LEFT JOIN elder_friend_event_participants viewer
       ON viewer.event_id = e.event_id AND viewer.user_id = $2
     LEFT JOIN elder_friend_event_participants p ON p.event_id = e.event_id
     LEFT JOIN users u ON u.user_id = p.user_id
     WHERE e.event_id = $1
     GROUP BY e.event_id, e.host_user_id, e.title, e.description, e.start_time, e.location, e.created_at, host.user_id, viewer.status
     LIMIT 1`,
    [eventId, viewerId]
  )
  if (!rows.length) return null
  const event = rows[0]
  if (event.host_user_id === viewerId) {
    event.viewer_status = 'host'
  } else if (!event.viewer_status) {
    event.viewer_status = null
  }
  return event
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const viewer = await ensureElder(req.userId)
    if (!viewer) {
      return res.status(403).json({ error: 'elders_only' })
    }
    const friendIds = await fetchFriendIds(req.userId)
    const allowedHostIds = Array.from(new Set([req.userId, ...friendIds]))

    const { rows } = await pool.query(
      `WITH targets AS (
        SELECT e.*
        FROM elder_friend_events e
        WHERE e.host_user_id = ANY($1)
           OR EXISTS (
             SELECT 1 FROM elder_friend_event_participants ep
             WHERE ep.event_id = e.event_id AND ep.user_id = $2
           )
      )
      SELECT e.event_id,
             e.host_user_id,
             e.title,
             e.description,
             e.start_time,
             e.location,
             e.created_at,
             json_build_object(
               'user_id', host.user_id,
               'full_name', host.full_name,
               'username', host.username,
               'phone', host.phone
             ) AS host,
             viewer.status AS viewer_status,
             COALESCE(
               json_agg(
                 json_build_object(
                   'user_id', p.user_id,
                   'status', p.status,
                   'full_name', u.full_name,
                   'username', u.username
                 )
                 ORDER BY p.created_at ASC
               ) FILTER (WHERE p.user_id IS NOT NULL),
               '[]'
             ) AS participants
      FROM targets e
      JOIN users host ON host.user_id = e.host_user_id
      LEFT JOIN elder_friend_event_participants viewer
        ON viewer.event_id = e.event_id AND viewer.user_id = $2
      LEFT JOIN elder_friend_event_participants p ON p.event_id = e.event_id
      LEFT JOIN users u ON u.user_id = p.user_id
      GROUP BY e.event_id, e.host_user_id, e.title, e.description, e.start_time, e.location, e.created_at, host.user_id, viewer.status
      ORDER BY e.start_time ASC, e.event_id ASC`,
      [allowedHostIds, req.userId]
    )

    const events = rows.map((event) => ({
      ...event,
      viewer_status: event.host_user_id === req.userId ? 'host' : event.viewer_status
    }))
    res.json({ events })
  } catch (error) {
    next(error)
  }
})

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const viewer = await ensureElder(req.userId)
    if (!viewer) {
      return res.status(403).json({ error: 'elders_only' })
    }
    const { title, description, start_time, location, participant_user_ids } = req.body || {}
    if (!title || !start_time) {
      return res.status(400).json({ error: 'invalid_payload' })
    }

    const startDate = ensureTaipeiDate(start_time)
    if (!startDate) {
      return res.status(400).json({ error: 'invalid_start_time' })
    }

    const friendIds = await fetchFriendIds(req.userId)
    const allowedParticipants = new Set(friendIds)

    const sanitizedParticipants = Array.isArray(participant_user_ids)
      ? participant_user_ids
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id !== req.userId && allowedParticipants.has(id))
      : []

    const uniqueParticipantIds = Array.from(new Set(sanitizedParticipants))

    const eventInsert = await pool.query(
      `INSERT INTO elder_friend_events (host_user_id, title, description, start_time, location)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING event_id`,
      [req.userId, title.trim(), description ?? null, startDate.toISOString(), location ?? null]
    )
    const eventId = eventInsert.rows[0].event_id

    const participants = [
      { user_id: req.userId, status: PARTICIPANT_STATUS.going },
      ...uniqueParticipantIds.map((id) => ({ user_id: id, status: PARTICIPANT_STATUS.invited }))
    ]

    for (const participant of participants) {
      await pool.query(
        `INSERT INTO elder_friend_event_participants (event_id, user_id, status)
         VALUES ($1,$2,$3)
         ON CONFLICT (event_id, user_id)
         DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
        [eventId, participant.user_id, participant.status]
      )
    }

    try {
      const now = new Date()
      if (sameDayInTaipei(startDate, now)) {
        await pool.query(
          `INSERT INTO user_events (
             user_id, owner_user_id, title, description, start_time, end_time, location, category, is_all_day
           ) VALUES ($1,$1,$2,$3,$4,$4,$5,$6,false)`,
          [
            req.userId,
            title.trim(),
            description ?? '好友活動提醒',
            startDate.toISOString(),
            location ?? null,
            'social'
          ]
        )
      }
    } catch (error) {
      console.warn('[friend-events] 無法同步今日提醒：', error.message)
    }

    const event = await fetchEventForViewer(eventId, req.userId)
    return res.status(201).json({ event })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/rsvp', requireAuth, async (req, res, next) => {
  try {
    const eventId = Number(req.params.id)
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ error: 'invalid_id' })
    }
    const desiredStatus = String(req.body?.status || '').toLowerCase()
    if (![PARTICIPANT_STATUS.going, PARTICIPANT_STATUS.declined].includes(desiredStatus)) {
      return res.status(400).json({ error: 'invalid_status' })
    }

    const viewer = await ensureElder(req.userId)
    if (!viewer) {
      return res.status(403).json({ error: 'elders_only' })
    }

    const event = await pool.query(
      'SELECT event_id, host_user_id FROM elder_friend_events WHERE event_id = $1 LIMIT 1',
      [eventId]
    )
    if (event.rowCount === 0) {
      return res.status(404).json({ error: 'not_found' })
    }
    const hostId = event.rows[0].host_user_id
    if (hostId !== req.userId) {
      const friendIds = await fetchFriendIds(req.userId)
      if (!friendIds.includes(hostId)) {
        return res.status(403).json({ error: 'forbidden' })
      }
    }

    await pool.query(
      `INSERT INTO elder_friend_event_participants (event_id, user_id, status)
       VALUES ($1,$2,$3)
       ON CONFLICT (event_id, user_id)
       DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
      [eventId, req.userId, desiredStatus]
    )

    const payload = await fetchEventForViewer(eventId, req.userId)
    return res.json({ event: payload })
  } catch (error) {
    next(error)
  }
})

export default router
