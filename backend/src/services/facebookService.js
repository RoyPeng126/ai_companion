import axios from 'axios'
import pool from '../db/pool.js'
import { decryptFacebookToken } from '../utils/facebookTokens.js'

const GRAPH_API_BASE = (process.env.FACEBOOK_GRAPH_API_URL || 'https://graph.facebook.com/v19.0').replace(/\/$/, '')
const GRAPH_FIELDS = [
  'id',
  'message',
  'story',
  'permalink_url',
  'created_time',
  'from{name}'
].join(',')

const CACHE_TTL = Number.parseInt(process.env.FACEBOOK_CACHE_TTL_MS ?? '', 10)
const TTL_MS = Number.isFinite(CACHE_TTL) && CACHE_TTL > 0 ? CACHE_TTL : 3 * 60 * 1000

const LOOKBACK_DAYS = Number.parseInt(process.env.FACEBOOK_POST_LOOKBACK_DAYS ?? '', 10)
const POST_LOOKBACK_DAYS = Number.isFinite(LOOKBACK_DAYS) && LOOKBACK_DAYS > 0 ? LOOKBACK_DAYS : 3650
const LOOKBACK_SECONDS = POST_LOOKBACK_DAYS * 24 * 60 * 60

const MAX_TOTAL_LIMIT = 30
const MAX_PER_MEMBER = 5

const sanitizeIdentifier = (value) => {
  if (!value) return ''
  return /^[A-Za-z0-9_]+$/.test(value) ? value : ''
}

const TOKEN_TABLE = sanitizeIdentifier(process.env.FACEBOOK_TOKEN_TABLE) || 'oauth_facebook_tokens'
const SHARE_TABLE = sanitizeIdentifier(process.env.FAMILY_FEED_SHARE_TABLE) || 'family_feed_shares'

const warnedTables = new Set()
const warnMissingTable = (table, error) => {
  if (warnedTables.has(table)) return
  warnedTables.add(table)
  console.warn(`[facebookService] Table "${table}" unavailable (${error.code || 'error'}): ${error.message}`)
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

const summarizeForElder = (text) => {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  if (!normalized) return '（這則貼文沒有提供文字內容）'
  if (normalized.length <= 140) return normalized
  return `${normalized.slice(0, 137)}...`
}

const parsePageSources = () => {
  const raw = process.env.FACEBOOK_PAGE_SOURCES
  if (!raw) return []
  return raw
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const [pageId, token, displayName] = entry.split('|').map(part => part?.trim())
      if (!pageId || !token) return null
      return {
        pageId,
        access_token: token,
        speakerName: displayName || `粉絲專頁 ${pageId}`
      }
    })
    .filter(Boolean)
}

const legacySource = () => {
  const token = (process.env.FACEBOOK_ACCESS_TOKEN || '').trim()
  if (!token) return null
  return {
    access_token: token,
    speakerName: process.env.FACEBOOK_LEGACY_DISPLAY_NAME || '親友分享',
    source: 'facebook_legacy'
  }
}

const fetchGraphPosts = async ({ edge, accessToken, limit }) => {
  if (!accessToken) return []
  const url = `${GRAPH_API_BASE}/${edge.replace(/^\//, '')}`
  const sinceTs = Math.floor(Date.now() / 1000) - LOOKBACK_SECONDS
  const response = await axios.get(url, {
    params: {
      access_token: accessToken,
      fields: GRAPH_FIELDS,
      limit: clamp(limit, 1, MAX_PER_MEMBER * 2),
      since: sinceTs
    },
    timeout: 8000
  })
  return response.data?.data ?? []
}

const mapGraphPost = ({ post, speakerName, source }) => {
  if (!post) return null

  const segments = [
    post.message,
    post.story,
    post.attachments?.data?.[0]?.description
  ]
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)

  const combinedText = segments.join('\n')
  const hasInfo = combinedText || post.permalink_url || post.attachments?.data?.[0]?.unshimmed_url
  if (!hasInfo) return null

  return {
    id: post.id,
    speakerName: speakerName || post.from?.name || '家人',
    ttsText: summarizeForElder(combinedText || '（此貼文沒有文字內容）'),
    link: post.permalink_url || post.attachments?.data?.[0]?.unshimmed_url || '',
    createdTimeISO: post.created_time,
    source
  }
}

const fetchFamilyUserIds = async (elderId) => {
  if (!Number.isFinite(elderId)) return []
  const sql = `
    SELECT user_id
    FROM users
    WHERE user_id = $1
       OR owner_user_id = $1
  `
  try {
    const { rows } = await pool.query(sql, [elderId])
    return rows.map(row => row.user_id)
  } catch (error) {
    console.warn('[facebookService] 無法查詢家庭成員：', error.message)
    return []
  }
}

const normalizeMemberIds = (elderId, overrideIds = []) => {
  const ids = Array.isArray(overrideIds) ? overrideIds.filter(id => Number.isFinite(Number(id))).map(id => Number(id)) : []
  if (Number.isFinite(elderId)) ids.push(Number(elderId))
  return Array.from(new Set(ids))
}

const fetchMemberTokenRecords = async (elderId, overrideMemberIds = []) => {
  if (!Number.isFinite(elderId)) return []
  let memberIds = normalizeMemberIds(elderId, overrideMemberIds)
  if (!memberIds.length) {
    memberIds = await fetchFamilyUserIds(elderId)
  }
  if (!memberIds.length) return []
  const sql = `
    SELECT u.user_id, u.full_name, u.username, u.relation, u.charactor,
           t.fb_user_id, t.access_token_enc, t.expires_at
    FROM ${TOKEN_TABLE} t
    JOIN users u ON u.user_id = t.user_id
    WHERE t.user_id = ANY($1::int[])
      AND (t.expires_at IS NULL OR t.expires_at > now())
  `
  try {
    const { rows } = await pool.query(sql, [memberIds])
    return rows
      .map(row => {
        const token = decryptFacebookToken(row.access_token_enc)
        if (!token) return null
        return {
          ...row,
          access_token: token
        }
      })
      .filter(Boolean)
  } catch (error) {
    if (error.code === '42P01') {
      warnMissingTable(TOKEN_TABLE, error)
      return []
    }
    throw error
  }
}

const fetchManualShares = async ({ elderId, limit }) => {
  if (!Number.isFinite(elderId)) return []
  const sql = `
    SELECT id, elder_id, speaker_name, summary, link_url, created_at
    FROM ${SHARE_TABLE}
    WHERE elder_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `
  try {
    const { rows } = await pool.query(sql, [elderId, limit])
    return rows.map(row => ({
      id: `manual:${row.id}`,
      speakerName: row.speaker_name || '親友',
      ttsText: row.summary || row.link_url || '已分享一則連結',
      link: row.link_url || '',
      createdTimeISO: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      source: 'manual_share'
    }))
  } catch (error) {
    if (error.code === '42P01') {
      warnMissingTable(SHARE_TABLE, error)
      return []
    }
    throw error
  }
}

const fetchMemberPosts = async (record, limit) => {
  if (!record?.access_token) return []
  const speakerName = record.full_name || record.username || record.relation || '家人'
  const posts = await fetchGraphPosts({
    edge: 'me/posts',
    accessToken: record.access_token,
    limit
  })
  return posts
    .map(post => mapGraphPost({ post, speakerName, source: 'facebook_member' }))
    .filter(Boolean)
    .slice(0, limit)
}

const fetchLegacyPosts = async (limit, sourceInfo = legacySource()) => {
  if (!sourceInfo) return []
  const posts = await fetchGraphPosts({
    edge: 'me/posts',
    accessToken: sourceInfo.access_token,
    limit
  })
  return posts
    .map(post => mapGraphPost({ post, speakerName: sourceInfo.speakerName, source: sourceInfo.source }))
    .filter(Boolean)
    .slice(0, limit)
}

const fetchPagePosts = async (limit, sources = parsePageSources()) => {
  if (!sources.length) return []
  const settled = await Promise.allSettled(
    sources.map(source =>
      fetchGraphPosts({
        edge: `${source.pageId}/posts`,
        accessToken: source.access_token,
        limit
      }).then(posts =>
        posts
          .map(post => mapGraphPost({ post, speakerName: source.speakerName, source: 'facebook_page' }))
          .filter(Boolean)
          .slice(0, limit)
      )
    )
  )
  return settled
    .flatMap(result => (result.status === 'fulfilled' ? result.value : []))
}

const cache = new Map()

export const getFamilyFeed = async ({
  elderId,
  familyUserIds = [],
  perMemberLimit = 3,
  totalLimit = 12,
  includeManualShares = true,
  forceRefresh = false
} = {}) => {
  const safePerMember = clamp(Number.parseInt(perMemberLimit, 10) || 3, 1, MAX_PER_MEMBER)
  const safeTotal = clamp(Number.parseInt(totalLimit, 10) || 12, 1, MAX_TOTAL_LIMIT)
  const manualFlag = includeManualShares ? 1 : 0
  const cacheKey = JSON.stringify([elderId || 'self', safePerMember, safeTotal, manualFlag, familyUserIds.join('|')])

  if (!forceRefresh) {
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value
    }
  }

  const elderNumericId = Number.isFinite(Number(elderId)) ? Number(elderId) : null
  const pageSources = parsePageSources()
  const legacyInfo = legacySource()

  const [memberRecords, manualShares, legacyPosts] = await Promise.all([
    fetchMemberTokenRecords(elderNumericId ?? NaN, familyUserIds),
    includeManualShares && Number.isFinite(elderNumericId)
      ? fetchManualShares({ elderId: elderNumericId, limit: safeTotal })
      : Promise.resolve([]),
    fetchLegacyPosts(safePerMember, legacyInfo)
  ])

  const memberSettled = await Promise.allSettled(
    memberRecords.map(record => fetchMemberPosts(record, safePerMember))
  )
  const memberItems = memberSettled.flatMap(result =>
    result.status === 'fulfilled' ? result.value : []
  )
  const pageItems = await fetchPagePosts(safePerMember, pageSources)

  const aggregated = [
    ...memberItems,
    ...pageItems,
    ...legacyPosts,
    ...(Array.isArray(manualShares) ? manualShares : [])
  ]

  aggregated.sort((a, b) => {
    const tsA = Date.parse(a?.createdTimeISO || 0) || 0
    const tsB = Date.parse(b?.createdTimeISO || 0) || 0
    return tsB - tsA
  })

  const items = aggregated.slice(0, safeTotal)
  const meta = {
    facebook: {
      memberTokens: memberRecords.length,
      pageSources: pageSources.length,
      legacyFallback: Boolean(legacyInfo),
      totalConfigured: memberRecords.length + pageSources.length + (legacyInfo ? 1 : 0)
    },
    manualShares: {
      included: !!includeManualShares,
      count: Array.isArray(manualShares) ? manualShares.length : 0
    }
  }

  const value = { items, meta }
  cache.set(cacheKey, { value, expiresAt: Date.now() + TTL_MS })
  return value
}

export const getFamilyFeedItems = async (options = {}) => {
  const { items } = await getFamilyFeed(options)
  return items
}

export const getFriendPosts = async ({ elderId, limit = 5, forceRefresh = false } = {}) => {
  const { items, meta } = await getFamilyFeed({
    elderId,
    perMemberLimit: Math.min(limit, MAX_PER_MEMBER),
    totalLimit: limit,
    includeManualShares: false,
    forceRefresh
  })

  const posts = items
    .filter(item =>
      item.source === 'facebook_member' ||
      item.source === 'facebook_page' ||
      item.source === 'facebook_legacy'
    )
    .map(item => ({
      id: item.id,
      author: item.speakerName,
      text: item.ttsText,
      permalink: item.link,
      createdTime: item.createdTimeISO
    }))

  if (!posts.length && (meta.facebook?.totalConfigured ?? 0) === 0) {
    const error = new Error('Facebook 存取權杖未設定')
    error.code = 'FACEBOOK_CONFIG_MISSING'
    throw error
  }

  return posts
}
