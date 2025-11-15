import express from 'express'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { belongsToSameFamily, resolveElderIdForUser } from '../utils/family.js'
import { transcribeAudio } from '../services/speechService.js'
import {
  recordInterestEntry,
  fetchStyleEntries,
  STYLE_LIMITS
} from '../services/companionStyleService.js'
import pool from '../db/pool.js'

const router = express.Router()
router.use(withCookies)
router.use(requireAuth)

const fetchUserWithOwners = async (userId) => {
  const { rows } = await pool.query(
    `SELECT user_id, full_name, username, owner_user_ids, charactor, gender
     FROM users
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  )
  return rows[0] ?? null
}

const resolveTargetElder = async (viewerId, elderCandidateId) => {
  const viewer = await fetchUserWithOwners(viewerId)
  if (!viewer) {
    const error = new Error('viewer_not_found')
    error.status = 404
    throw error
  }

  let resolvedElderId = null
  const numericCandidate = Number(elderCandidateId)
  if (Number.isFinite(numericCandidate) && numericCandidate > 0) {
    resolvedElderId = numericCandidate
  } else {
    resolvedElderId = resolveElderIdForUser(viewer)
  }

  if (!resolvedElderId) {
    const error = new Error('elder_unavailable')
    error.status = 409
    throw error
  }

  const elder = await fetchUserWithOwners(resolvedElderId)
  if (!elder) {
    const error = new Error('elder_not_found')
    error.status = 404
    throw error
  }

  if (
    viewer.user_id !== elder.user_id &&
    !belongsToSameFamily(viewer, elder)
  ) {
    const error = new Error('forbidden')
    error.status = 403
    throw error
  }

  return { viewer, elder }
}

const mapInterest = (row) => ({
  id: row.id,
  elder_user_id: row.elder_user_id,
  elder_name: row.elder_name,
  interest: row.interest,
  created_at: row.created_at
})

const mapChatHistory = (row) => ({
  id: row.id,
  role: row.message_role || 'user',
  message: row.chat_message || row.interest || '',
  created_at: row.created_at
})

router.get('/', async (req, res, next) => {
  try {
    const { elder } = await resolveTargetElder(req.userId, req.query.elder_user_id)
    const elderName = elder.full_name || elder.username || `長者 #${elder.user_id}`
    const interestRows = await fetchStyleEntries({
      elderId: elder.user_id,
      entryType: 'interest',
      limit: STYLE_LIMITS.interest
    })
    const chatRows = await fetchStyleEntries({
      elderId: elder.user_id,
      entryType: 'chat',
      limit: STYLE_LIMITS.chat
    })
    return res.json({
      elder: {
        user_id: elder.user_id,
        full_name: elderName,
        gender: elder.gender ?? null
      },
      interests: interestRows.map(mapInterest),
      chatHistory: chatRows.map(mapChatHistory)
    })
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const interestText = (req.body?.interest ?? '').toString().trim()
    if (!interestText) {
      return res.status(400).json({ error: 'invalid_interest' })
    }

    const { elder, viewer } = await resolveTargetElder(req.userId, req.body?.elder_user_id)
    const record = await recordInterestEntry({
      elder,
      elderId: elder.user_id,
      createdBy: viewer.user_id,
      interest: interestText
    })
    if (!record) {
      return res.status(500).json({ error: 'save_failed' })
    }
    return res.status(201).json({ interest: mapInterest(record) })
  } catch (error) {
    next(error)
  }
})

router.post('/voice', async (req, res, next) => {
  try {
    const audio = req.body?.audio
    if (!audio?.content) {
      return res.status(400).json({ error: 'missing_audio' })
    }
    const { elder, viewer } = await resolveTargetElder(req.userId, req.body?.elder_user_id)
    const transcription = await transcribeAudio({
      audioContent: audio.content,
      languageCode: audio.languageCode ?? 'zh-TW',
      encoding: audio.encoding ?? 'LINEAR16',
      sampleRateHertz: audio.sampleRateHertz ?? 16000
    })
    const transcript = transcription?.transcript?.trim()
    if (!transcript) {
      return res.status(422).json({ error: 'empty_transcript' })
    }
    const record = await recordInterestEntry({
      elder,
      elderId: elder.user_id,
      createdBy: viewer.user_id,
      interest: transcript
    })
    if (!record) {
      return res.status(500).json({ error: 'save_failed' })
    }
    return res.status(201).json({
      interest: mapInterest(record),
      transcript
    })
  } catch (error) {
    next(error)
  }
})

export default router
