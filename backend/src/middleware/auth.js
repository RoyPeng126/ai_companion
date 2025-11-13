import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'

export const COOKIE_NAME = 'ai_auth'

export const withCookies = cookieParser()

export function extractToken (req) {
  const cookieToken = req.cookies?.[COOKIE_NAME]
  if (cookieToken) return cookieToken
  const header = req.get?.('authorization') || req.headers?.authorization
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim()
    if (token) return token
  }
  return null
}

export function requireAuth (req, res, next) {
  try {
    const token = extractToken(req)
    if (!token) return res.status(401).json({ error: 'unauthorized' })
    const secret = process.env.JWT_SECRET || 'dev_secret_change_me'
    const payload = jwt.verify(token, secret)
    req.userId = payload.uid
    next()
  } catch (_) {
    return res.status(401).json({ error: 'unauthorized' })
  }
}
