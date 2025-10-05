import express from 'express'
import bodyParser from 'body-parser'
import dotenv from 'dotenv'
import morgan from 'morgan'

import chatRouter from './routes/chat.js'
import rankingRouter from './routes/ranking.js'
import geofenceRouter from './routes/geofence.js'

dotenv.config()

const app = express()
app.use(bodyParser.json({ limit: '30mb' }))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(morgan('dev'))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/chat', chatRouter)
app.use('/api/ranking', rankingRouter)
app.use('/api/geofence', geofenceRouter)

app.use((err, req, res, next) => {
  console.error(err)
  res.status(err.status || 500).json({
    error: err.message ?? '伺服器發生錯誤'
  })
})

const port = process.env.PORT || 3001

app.listen(port, () => {
  console.log(`AI Companion backend running on port ${port}`)
})
