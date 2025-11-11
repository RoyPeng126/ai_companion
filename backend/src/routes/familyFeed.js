import express from 'express'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { getFamilyFeed } from '../services/facebookService.js'
import { fetchUserRelation, belongsToSameFamily } from '../utils/family.js'

const router = express.Router()
router.use(withCookies)

const clampNumber = (value, { min, max, fallback }) => {
  const num = Number.parseInt(value, 10)
  if (!Number.isFinite(num)) return fallback
  return Math.min(Math.max(num, min), max)
}

router.get('/for-elder/:elderId', requireAuth, async (req, res, next) => {
  try {
    const elderId = Number.parseInt(req.params.elderId, 10)
    if (!Number.isFinite(elderId)) {
      return res.status(400).json({ error: 'invalid_elder_id' })
    }

    const [requester, elder] = await Promise.all([
      fetchUserRelation(req.userId),
      fetchUserRelation(elderId)
    ])

    if (!requester) {
      return res.status(401).json({ error: 'unauthorized' })
    }
    if (!elder) {
      return res.status(404).json({ error: 'elder_not_found' })
    }
    if (!belongsToSameFamily(requester, elder)) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const totalLimit = clampNumber(req.query.limit, { min: 1, max: 30, fallback: 12 })
    const perMemberLimit = clampNumber(req.query.perMember ?? req.query.per_member, { min: 1, max: 5, fallback: 3 })
    const includeManualShares = req.query.manual === 'false' ? false : true

    let familyMemberIds = []
    try {
      const { rows } = await pool.query(
        'SELECT user_id FROM users WHERE owner_user_id = $1 ORDER BY user_id ASC',
        [elderId]
      )
      familyMemberIds = rows.map(row => row.user_id)
    } catch (error) {
      console.warn('[family-feed] 無法查詢家屬列表：', error.message)
    }

    const result = await getFamilyFeed({
      elderId,
      familyUserIds: familyMemberIds,
      totalLimit,
      perMemberLimit,
      includeManualShares,
      forceRefresh: req.query.refresh === 'true'
    })

    return res.json(result)
  } catch (error) {
    next(error)
  }
})

export default router
