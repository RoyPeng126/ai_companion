import express from 'express'
import { getDistance } from 'geolib'
import { notificationService } from '../services/notificationService.js'

const router = express.Router()

router.post('/check', async (req, res, next) => {
  try {
    const { userId, familyId, location, geofence } = req.body

    if (!userId || !location || !geofence) {
      return res.status(400).json({ error: 'userId、location、geofence 為必填欄位' })
    }

    const distance = getDistance(
      { latitude: location.lat, longitude: location.lng },
      { latitude: geofence.center.lat, longitude: geofence.center.lng }
    )

    const outside = distance > geofence.radiusMeters

    let notification
    if (outside) {
      notification = notificationService.push({
        type: 'GEOFENCE_ALERT',
        userId,
        familyId,
        message: `使用者 ${userId} 超出安全範圍 ${Math.round(distance)} 公尺`,
        metadata: {
          location,
          geofence,
          distance
        }
      })
    }

    res.json({
      outside,
      distance,
      radiusMeters: geofence.radiusMeters,
      notification
    })
  } catch (error) {
    next(error)
  }
})

router.get('/notifications/:familyId', (req, res) => {
  const notifications = notificationService.listByFamily(req.params.familyId)
  res.json({ items: notifications })
})

export default router
