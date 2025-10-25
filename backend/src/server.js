import './config/env.js'

import express from 'express'
import bodyParser from 'body-parser'
import morgan from 'morgan'
import cors from 'cors'
import chatRouter from './routes/chat.js'
import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'
import rankingRouter from './routes/ranking.js'
import geofenceRouter from './routes/geofence.js'

const app = express()
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean)
  : ['http://localhost:3000']

app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : '*',
  credentials: true
}))
app.use(bodyParser.json({ limit: '30mb' }))
app.use(bodyParser.urlencoded({ extended: true }))
app.use(morgan('dev'))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/chat', chatRouter)
app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
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
