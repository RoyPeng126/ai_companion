import express from 'express'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { fetchUserRelation, belongsToSameFamily } from '../utils/family.js'
import { normalizeRole } from '../utils/normalize.js'

const router = express.Router()
router.use(withCookies)
router.use(requireAuth)

const toNumber = (value) => {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const normalizeText = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

async function assertCanManageElder (requesterId, elderId) {
  if (!Number.isFinite(requesterId)) {
    const error = new Error('unauthorized')
    error.status = 401
    throw error
  }
  const numericElderId = toNumber(elderId)
  if (!numericElderId) {
    const error = new Error('invalid_elder_id')
    error.status = 400
    throw error
  }

  const [requester, elder] = await Promise.all([
    fetchUserRelation(requesterId),
    fetchUserRelation(numericElderId)
  ])

  if (!elder) {
    const error = new Error('elder_not_found')
    error.status = 404
    throw error
  }
  const elderRole = normalizeRole(elder.charactor || '')
  if (elderRole && elderRole !== 'elder') {
    const error = new Error('target_not_elder')
    error.status = 400
    throw error
  }
  if (!requester) {
    const error = new Error('requester_not_found')
    error.status = 404
    throw error
  }
  if (!belongsToSameFamily(requester, elder)) {
    const error = new Error('forbidden')
    error.status = 403
    throw error
  }
  return numericElderId
}

router.get('/:elderId', async (req, res, next) => {
  try {
    const elderId = await assertCanManageElder(req.userId, req.params.elderId)
    const { rows } = await pool.query(
      `SELECT id, elder_user_id, address, latitude, longitude, county, district, detail, updated_at
       FROM elder_locations
       WHERE elder_user_id = $1
       LIMIT 1`,
      [elderId]
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: 'location_not_found' })
    }
    return res.json({ location: rows[0] })
  } catch (error) {
    next(error)
  }
})

router.put('/:elderId', async (req, res, next) => {
  try {
    const elderId = await assertCanManageElder(req.userId, req.params.elderId)
    const {
      address,
      lat,
      lon,
      latitude: bodyLatitude,
      longitude: bodyLongitude,
      county,
      district,
      detail
    } = req.body || {}
    const latitude = toNumber(lat ?? bodyLatitude)
    const longitude = toNumber(lon ?? bodyLongitude)
    const normalizedAddress = typeof address === 'string' ? address.trim() : ''
    if (!normalizedAddress) {
      return res.status(400).json({ error: 'invalid_address' })
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'invalid_coordinates' })
    }

    const normalizedCounty = normalizeText(county)
    const normalizedDistrict = normalizeText(district)
    const normalizedDetail = normalizeText(detail)

    const { rows } = await pool.query(
      `INSERT INTO elder_locations (elder_user_id, address, latitude, longitude, county, district, detail, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (elder_user_id) DO UPDATE
         SET address = EXCLUDED.address,
             latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             county = EXCLUDED.county,
             district = EXCLUDED.district,
             detail = EXCLUDED.detail,
             updated_by = EXCLUDED.updated_by,
             updated_at = now()
       RETURNING id, elder_user_id, address, latitude, longitude, county, district, detail, updated_at`,
      [
        elderId,
        normalizedAddress,
        latitude,
        longitude,
        normalizedCounty,
        normalizedDistrict,
        normalizedDetail,
        req.userId
      ]
    )

    return res.json({ location: rows[0] })
  } catch (error) {
    next(error)
  }
})

export default router
