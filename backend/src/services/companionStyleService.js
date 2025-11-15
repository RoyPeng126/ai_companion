import pool from '../db/pool.js'

const LIMITS = {
  interest: 20,
  chat: 40
}
const KEYWORD_LIMIT = 6

const buildDisplayName = (profile) =>
  profile?.full_name ||
  profile?.username ||
  (profile?.user_id ? `長者 #${profile.user_id}` : '長者')

const pruneEntries = async (elderId, entryType) => {
  const limit = entryType === 'chat' ? LIMITS.chat : LIMITS.interest
  await pool.query(
    `DELETE FROM companion_styles
     WHERE elder_user_id = $1
       AND entry_type = $2
       AND id NOT IN (
         SELECT id FROM companion_styles
         WHERE elder_user_id = $1 AND entry_type = $2
         ORDER BY created_at DESC
         LIMIT $3
       )`,
    [elderId, entryType, limit]
  )
}

export const fetchElderProfile = async (elderId) => {
  if (!Number.isFinite(elderId)) return null
  const { rows } = await pool.query(
    `SELECT user_id, full_name, username, gender
     FROM users
     WHERE user_id = $1
     LIMIT 1`,
    [elderId]
  )
  if (!rows.length) return null
  return rows[0]
}

export const insertStyleEntry = async ({
  elderId,
  elderName,
  elderGender,
  createdBy,
  entryType = 'interest',
  interest = null,
  chatMessage = null,
  messageRole = null
}) => {
  if (!Number.isFinite(elderId)) {
    throw new Error('invalid_elder_id')
  }

  const normalizedType = entryType === 'chat' ? 'chat' : 'interest'
  const displayName = elderName || `長者 #${elderId}`

  const { rows } = await pool.query(
    `INSERT INTO companion_styles (
       elder_user_id,
       elder_name,
       elder_gender,
       interest,
       chat_message,
       message_role,
       entry_type,
       created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, elder_user_id, elder_name, elder_gender, interest, chat_message, message_role, entry_type, created_at`,
    [
      elderId,
      displayName,
      elderGender ?? null,
      interest ?? null,
      chatMessage ?? null,
      messageRole ?? null,
      normalizedType,
      createdBy ?? null
    ]
  )

  await pruneEntries(elderId, normalizedType)
  return rows[0]
}

const extractKeywords = (text = '') => {
  const normalized = String(text).trim()
  if (!normalized) return ''
  const matches = normalized.match(/[\p{L}\p{N}]{2,}/gu) || []
  const deduped = []
  for (const token of matches) {
    const trimmed = token.slice(0, 8)
    if (trimmed && !deduped.includes(trimmed)) {
      deduped.push(trimmed)
    }
    if (deduped.length >= KEYWORD_LIMIT) break
  }
  return deduped.join('、')
}

export const recordInterestEntry = async ({ elder, elderId, createdBy, interest }) => {
  if (!interest) return null
  const profile = elder || (await fetchElderProfile(elderId))
  if (!profile) return null
  return insertStyleEntry({
    elderId: profile.user_id ?? elder?.user_id ?? elderId,
    elderName: buildDisplayName(profile),
    elderGender: profile.gender ?? elder?.gender ?? null,
    createdBy,
    entryType: 'interest',
    interest
  })
}

export const recordChatEntry = async ({
  elder,
  elderId,
  createdBy,
  message,
  role = 'user'
}) => {
  if (!message || !message.trim()) return null
  const profile = elder || (await fetchElderProfile(elderId))
  if (!profile) return null
  const keywords = extractKeywords(message)
  return insertStyleEntry({
    elderId: profile.user_id ?? elderId,
    elderName: buildDisplayName(profile),
    elderGender: profile.gender ?? elder?.gender ?? null,
    createdBy,
    entryType: 'chat',
    chatMessage: keywords || message.trim().slice(0, 30),
    messageRole: role
  })
}

export const fetchStyleEntries = async ({ elderId, entryType, limit }) => {
  if (!Number.isFinite(elderId)) return []
  const normalizedType = entryType === 'chat' ? 'chat' : 'interest'
  const resolvedLimit =
    Number.isFinite(limit) && limit > 0 ? limit : LIMITS[normalizedType]
  const { rows } = await pool.query(
    `SELECT id, elder_user_id, elder_name, elder_gender, interest, chat_message, message_role, entry_type, created_at
     FROM companion_styles
     WHERE elder_user_id = $1 AND entry_type = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [elderId, normalizedType, resolvedLimit]
  )
  return rows
}

export const STYLE_LIMITS = { ...LIMITS }
