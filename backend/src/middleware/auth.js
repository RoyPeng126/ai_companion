import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'

export const COOKIE_NAME = 'ai_auth'

export const withCookies = cookieParser()

export function requireAuth (req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME]
    if (!token) return res.status(401).json({ error: 'unauthorized' })
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me'
    const payload = jwt.verify(token, secret)
    req.userId = payload.uid
    next()
  } catch (_) {
    return res.status(401).json({ error: 'unauthorized' })
  }
}

