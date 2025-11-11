import express from 'express'
import axios from 'axios'
import crypto from 'node:crypto'
import pool from '../db/pool.js'
import { getFriendPosts } from '../services/facebookService.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { fetchUserRelation, belongsToSameFamily, resolveElderIdForUser } from '../utils/family.js'
import { encryptFacebookToken, hasTokenSecret } from '../utils/facebookTokens.js'

const router = express.Router()
router.use(withCookies)

const GRAPH_API_BASE = (process.env.FACEBOOK_GRAPH_API_URL || 'https://graph.facebook.com/v19.0').replace(/\/$/, '')
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET
const FACEBOOK_OAUTH_REDIRECT_URI = process.env.FACEBOOK_OAUTH_REDIRECT_URI || 'http://localhost:3001/api/facebook/auth/callback'
const FACEBOOK_OAUTH_SUCCESS_URL = process.env.FACEBOOK_OAUTH_SUCCESS_URL || 'http://localhost:3000/setting.html?facebook=success'
const FACEBOOK_OAUTH_FAILURE_URL = process.env.FACEBOOK_OAUTH_FAILURE_URL || 'http://localhost:3000/setting.html?facebook=failed'
const STATE_TTL_MS = 10 * 60 * 1000
const oauthStateStore = new Map()

const createOauthState = (userId) => {
  const state = crypto.randomBytes(16).toString('hex')
  oauthStateStore.set(state, { userId, expiresAt: Date.now() + STATE_TTL_MS })
  return state
}

const consumeOauthState = (state) => {
  if (!state || !oauthStateStore.has(state)) return null
  const payload = oauthStateStore.get(state)
  oauthStateStore.delete(state)
  if (!payload || Date.now() > payload.expiresAt) {
    return null
  }
  return payload.userId
}

router.get('/posts', requireAuth, async (req, res, next) => {
  try {
    const limit = Number.parseInt(req.query.limit ?? '', 10) || 5
    const requester = await fetchUserRelation(req.userId)
    if (!requester) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    let elderId = resolveElderIdForUser(requester)
    const requestedElderId = Number.parseInt(req.query.elderId ?? req.query.elder_id ?? '', 10)
    if (Number.isFinite(requestedElderId)) {
      const elder = await fetchUserRelation(requestedElderId)
      if (elder && belongsToSameFamily(requester, elder)) {
        elderId = elder.user_id
      }
    }

    const posts = await getFriendPosts({ limit, elderId })
    res.json({ posts })
  } catch (error) {
    if (error.code === 'FACEBOOK_CONFIG_MISSING') {
      return res.json({
        posts: [],
        disabled: true,
        message: '尚未設定 Facebook 存取權杖'
      })
    }
    if (error.response) {
      return res.status(error.response.status || 502).json({
        error: 'facebook_api_error',
        message: error.response.data?.error?.message || 'Facebook API 呼叫失敗'
      })
    }
    next(error)
  }
})

router.get('/auth/url', requireAuth, async (req, res) => {
  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET || !hasTokenSecret()) {
    return res.status(400).json({ error: 'facebook_oauth_not_configured' })
  }
  const state = createOauthState(req.userId)
  const loginUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth')
  loginUrl.searchParams.set('client_id', FACEBOOK_APP_ID)
  loginUrl.searchParams.set('redirect_uri', FACEBOOK_OAUTH_REDIRECT_URI)
  loginUrl.searchParams.set('state', state)
  loginUrl.searchParams.set('response_type', 'code')
  loginUrl.searchParams.set('scope', 'public_profile,email,user_posts')
  return res.json({ url: loginUrl.toString() })
})

const handleOauthCallback = async (req, res) => {
  const redirectWithStatus = (baseUrl, status, message) => {
    try {
      const url = new URL(baseUrl)
      if (status) url.searchParams.set('status', status)
      if (message) url.searchParams.set('message', message)
      res.redirect(url.toString())
    } catch {
      res.status(status === 'success' ? 200 : 400).send(message || status || 'facebook_oauth')
    }
  }

  const { code, state, error: fbError, error_description: fbErrorDesc } = req.query
  if (fbError) {
    return redirectWithStatus(FACEBOOK_OAUTH_FAILURE_URL, 'error', fbErrorDesc || fbError)
  }
  const userId = consumeOauthState(state)
  if (!userId) {
    return redirectWithStatus(FACEBOOK_OAUTH_FAILURE_URL, 'error', 'state_invalid')
  }
  if (!code || !FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET || !hasTokenSecret()) {
    return redirectWithStatus(FACEBOOK_OAUTH_FAILURE_URL, 'error', 'config_missing')
  }

  try {
    const tokenRes = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
      params: {
        client_id: FACEBOOK_APP_ID,
        client_secret: FACEBOOK_APP_SECRET,
        redirect_uri: FACEBOOK_OAUTH_REDIRECT_URI,
        code
      },
      timeout: 8000
    })

    let accessToken = tokenRes.data?.access_token
    let expiresIn = tokenRes.data?.expires_in
    if (!accessToken) {
      throw new Error('no_access_token')
    }

    try {
      const longRes = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: FACEBOOK_APP_ID,
          client_secret: FACEBOOK_APP_SECRET,
          fb_exchange_token: accessToken
        },
        timeout: 8000
      })
      if (longRes.data?.access_token) {
        accessToken = longRes.data.access_token
        if (longRes.data.expires_in) expiresIn = longRes.data.expires_in
      }
    } catch (error) {
      console.warn('[facebook.oauth] exchange long-lived token failed:', error.message)
    }

    const profileRes = await axios.get(`${GRAPH_API_BASE}/me`, {
      params: { access_token: accessToken, fields: 'id,name' },
      timeout: 5000
    })
    const fbUserId = profileRes.data?.id
    if (!fbUserId) throw new Error('fb_user_id_missing')

    const encrypted = encryptFacebookToken(accessToken)
    const expiresAt = Number.isFinite(Number(expiresIn))
      ? new Date(Date.now() + Number(expiresIn) * 1000)
      : null

    await pool.query(
      `INSERT INTO oauth_facebook_tokens (user_id, fb_user_id, access_token_enc, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE
         SET fb_user_id = EXCLUDED.fb_user_id,
             access_token_enc = EXCLUDED.access_token_enc,
             expires_at = EXCLUDED.expires_at,
             updated_at = now()`,
      [userId, fbUserId, encrypted, expiresAt]
    )

    return redirectWithStatus(FACEBOOK_OAUTH_SUCCESS_URL, 'success', 'facebook_linked')
  } catch (error) {
    console.error('[facebook.oauth] callback failed', error)
    return redirectWithStatus(FACEBOOK_OAUTH_FAILURE_URL, 'error', 'exchange_failed')
  }
}

router.get('/auth/callback', handleOauthCallback)
router.get('/callback', handleOauthCallback)

export default router
