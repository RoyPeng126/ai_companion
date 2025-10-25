import express from 'express'
import { listMetrics, upsertMetric, getMetric } from '../db/healthMetricsStore.js'

const router = express.Router()

const sortMetrics = (metrics, metric) => {
  return [...metrics].sort((a, b) => {
    if (metric === 'medicationAdherence') {
      return (b[metric] ?? 0) - (a[metric] ?? 0)
    }
    return (b[metric] ?? 0) - (a[metric] ?? 0)
  })
}

router.get('/', async (req, res, next) => {
  try {
    const metric = req.query.metric ?? 'steps'
    const metrics = await listMetrics()
    const sorted = sortMetrics(metrics, metric)

    res.json({
      metric,
      items: sorted.map((item, index) => ({
        rank: index + 1,
        ...item
      }))
    })
  } catch (error) {
    next(error)
  }
})

router.get('/:userId', async (req, res, next) => {
  try {
    const entry = await getMetric(req.params.userId)
    if (!entry) {
      return res.status(404).json({ error: '找不到使用者資料' })
    }
    res.json(entry)
  } catch (error) {
    next(error)
  }
})

router.post('/sync', async (req, res, next) => {
  try {
    const { userId, displayName, steps, medicationAdherence, sleepHours } = req.body
    if (!userId) {
      return res.status(400).json({ error: 'userId 為必填欄位' })
    }

    const payload = await upsertMetric({
      userId,
      displayName,
      steps,
      medicationAdherence,
      sleepHours,
      lastSync: req.body.lastSync
    })

    res.status(201).json(payload)
  } catch (error) {
    next(error)
  }
})

export default router
