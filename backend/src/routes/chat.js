import express from 'express'
import { transcribeAudio } from '../services/speechService.js'
import { generateChatResponse, refineReminderTitle, classifyReminder } from '../services/geminiService.js'
import { synthesizeSpeech } from '../services/ttsService.js'
import { getFriendPosts } from '../services/facebookService.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { fetchUserRelation, resolveElderIdForUser } from '../utils/family.js'
import pool from '../db/pool.js'
import { normalizePhone, normalizeRole } from '../utils/normalize.js'
import { getPersona } from '../utils/personas.js'
import { recordChatEntry, fetchElderProfile } from '../services/companionStyleService.js'

const sanitizeContext = (context = []) => {
  if (!Array.isArray(context)) return []
  return context
    .filter(item => item && typeof item.text === 'string' && item.text.trim())
    .map(item => ({
      role: ['user', 'model', 'system'].includes(item.role) ? item.role : 'user',
      text: item.text.trim()
    }))
}

const summarizeFacebookPosts = (posts = []) => {
  if (!Array.isArray(posts)) return ''

  const normalized = posts
    .filter(post => post && post.text)
    .slice(0, 3)
    .map((post, index) => {
      const text = String(post.text).replace(/\s+/g, ' ').trim().slice(0, 300)
      const author = post.author || '親友'
      const timestamp = (() => {
        try {
          const date = new Date(post.createdTime)
          if (Number.isNaN(date.getTime())) return '近期'
          return date.toLocaleString('zh-TW', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          })
        } catch {
          return '近期'
        }
      })()
      const linkLabel = `連結${index + 1}`
      const permalink = post.permalink || '（無可分享的連結）'
      return `${author} 在 ${timestamp} 分享：「${text || '（此貼文無文字內容）'}」 ${linkLabel}：${permalink}`
    })

  if (!normalized.length) return ''

  return [
    '以下是獲得授權的 Facebook 親友貼文摘要，可用於回答長者的關心：',
    ...normalized,
    '若長者詢問親友近況，請親切朗讀貼文重點並附上原文連結。'
  ].join('\n')
}

const FRIEND_LIMIT = 10
const COMPANION_STYLE_LIMIT = 5
const TAIPEI_TZ = 'Asia/Taipei'
const eventWizardSessions = new Map()

const toTaipeiDateString = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  return formatter.format(date)
}

const buildTaipeiDayRange = (date = new Date()) => {
  const dateStr = toTaipeiDateString(date)
  const start = new Date(`${dateStr}T00:00:00+08:00`)
  const end = new Date(`${dateStr}T23:59:59.999+08:00`)
  return {
    dateStr,
    startIso: start.toISOString(),
    endIso: end.toISOString()
  }
}

const toTaipeiIso = (dateStr, timeStr = '09:00') => {
  if (!dateStr) return null
  const baseTime = timeStr && /\d{2}:\d{2}/.test(timeStr) ? timeStr : '09:00'
  const candidate = new Date(`${dateStr}T${baseTime}:00+08:00`)
  if (Number.isNaN(candidate.getTime())) return null
  return candidate.toISOString()
}

const formatTaipeiDateTime = (isoString) => {
  try {
    const date = new Date(isoString)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('zh-TW', {
      timeZone: TAIPEI_TZ,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })
  } catch {
    return ''
  }
}

const extractLocationFromText = (text = '') => {
  const match = text.match(/(?:在|到|去)\s*([\u4e00-\u9fa5A-Za-z0-9\s]{1,20})/)
  if (match) return match[1].trim()
  return ''
}

const TAIPEI_DAY_MS = 24 * 60 * 60 * 1000

const getTaipeiStartOfDay = (reference = new Date()) => {
  const ymd = toTaipeiDateString(reference)
  return new Date(`${ymd}T00:00:00+08:00`)
}

const formatTaipeiYmd = (date) => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TAIPEI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

const detectDateFromText = (text = '') => {
  if (!text) return null
  const normalized = text.replace(/\s+/g, '')
  const base = getTaipeiStartOfDay()
  const format = (date) => formatTaipeiYmd(date)

  if (normalized.includes('後天')) {
    return format(new Date(base.getTime() + 2 * TAIPEI_DAY_MS))
  }
  if (normalized.includes('明天')) {
    return format(new Date(base.getTime() + TAIPEI_DAY_MS))
  }
  if (normalized.includes('今天')) {
    return format(base)
  }
  if (normalized.includes('昨天')) {
    return format(new Date(base.getTime() - TAIPEI_DAY_MS))
  }

  const mdMatch = normalized.match(/(\d{1,2})(?:月|\/|\.|-)(\d{1,2})(?:日|號)?/)
  if (mdMatch) {
    const month = Number(mdMatch[1])
    const day = Number(mdMatch[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year = base.getFullYear()
      const candidate = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`)
      if (candidate.getTime() < base.getTime()) {
        year += 1
      }
      const adjusted = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00+08:00`)
      return formatTaipeiYmd(adjusted)
    }
  }
  return null
}

const digitsFromText = (text = '') => {
  const numMap = {
    '零': '0', '〇': '0', '○': '0', O: '0', 'ｏ': '0', o: '0',
    '一': '1', '二': '2', '三': '3', '四': '4', '五': '5',
    '六': '6', '七': '7', '八': '8', '九': '9',
    '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
    '５': '5', '６': '6', '７': '7', '８': '8', '９': '9'
  }
  const normalized = (text || '')
    .split('')
    .map((ch) => (numMap[ch] !== undefined ? numMap[ch] : ch))
    .join('')
  const digits = normalized.replace(/\D+/g, '')
  if (digits.startsWith('886') && digits.length >= 11) {
    return digits.slice(3)
  }
  return digits
}

const fetchPendingFriendInvites = async (userId) => {
  const sql = `
    SELECT f.friendship_id, f.requester_id, u.full_name, u.username, u.phone, f.created_at
    FROM elder_friendships f
    JOIN users u ON u.user_id = f.requester_id
    WHERE f.addressee_id = $1 AND f.status = 'pending'
    ORDER BY f.created_at ASC
  `
  const { rows } = await pool.query(sql, [userId])
  return rows
}

const fetchPendingActivityInvites = async (userId) => {
  const sql = `
    SELECT p.event_id, e.title, e.start_time, e.location, host.full_name AS host_name
    FROM elder_friend_event_participants p
    JOIN elder_friend_events e ON e.event_id = p.event_id
    JOIN users host ON host.user_id = e.host_user_id
    WHERE p.user_id = $1 AND p.status = 'invited'
    ORDER BY e.start_time ASC
  `
  const { rows } = await pool.query(sql, [userId])
  return rows
}

const fetchFriendIds = async (userId) => {
  const sql = `
    SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
    FROM elder_friendships
    WHERE status = 'accepted'
      AND (requester_id = $1 OR addressee_id = $1)
  `
  const { rows } = await pool.query(sql, [userId])
  return rows.map((row) => row.friend_id)
}

const fetchTodayReminders = async (userId) => {
  const { startIso, endIso } = buildTaipeiDayRange()
  const sql = `
    SELECT id, title, start_time, location, status
    FROM user_events
    WHERE user_id = $1
      AND start_time >= $2
      AND start_time <= $3
    ORDER BY start_time ASC, id ASC
  `
  const { rows } = await pool.query(sql, [userId, startIso, endIso])
  return rows
}

const fetchExpiredReminders = async (userId) => {
  const { startIso, endIso } = buildTaipeiDayRange()
  const now = new Date()
  const sql = `
    SELECT id, title, start_time, location
    FROM user_events
    WHERE user_id = $1
      AND start_time >= $2
      AND start_time <= $3
      AND COALESCE(status, false) = false
      AND start_time <= $4
    ORDER BY start_time ASC, id ASC
  `
  const { rows } = await pool.query(sql, [userId, startIso, endIso, now.toISOString()])
  return rows
}

const handleFriendLimitCheck = async (userId) => {
  const sql = `
    SELECT COUNT(*)::int AS total
    FROM elder_friendships
    WHERE status = 'accepted'
      AND (requester_id = $1 OR addressee_id = $1)
  `
  const { rows } = await pool.query(sql, [userId])
  return rows[0]?.total ?? 0
}

const buildProactiveNote = async (userId) => {
  const [friendInvites, activityInvites, pendingReminders] = await Promise.all([
    fetchPendingFriendInvites(userId),
    fetchPendingActivityInvites(userId),
    fetchExpiredReminders(userId)
  ])

  const parts = []
  if (friendInvites.length) {
    parts.push(`你有 ${friendInvites.length} 則新的好友邀請，說「我要看好友邀請」就能聽到內容。`)
  }
  if (activityInvites.length) {
    parts.push(`你有 ${activityInvites.length} 場活動邀請，說「我要看活動邀請」可以決定要不要參加。`)
  }
  if (pendingReminders.length) {
    parts.push(`今天還有 ${pendingReminders.length} 件提醒尚未確認，說「今天有沒有達成」一起檢查。`)
  }
  return parts.join(' ')
}

const handleCreateReminder = async (text, userId) => {
  const parsed = await classifyReminder({ rawText: text, tz: TAIPEI_TZ }).catch(() => ({}))
  const detectedDate = parsed.date || detectDateFromText(text)
  const dateStr = detectedDate || toTaipeiDateString()
  const timeStr = parsed.time || '09:00'
  const startIso = toTaipeiIso(dateStr, timeStr)
  const title = (parsed.title || '生活提醒').slice(0, 60)
  const location = parsed.location || extractLocationFromText(text) || null

  if (!startIso) {
    return '我沒有聽懂提醒的時間，請再說一次日期與時間。'
  }

  await pool.query(
    `INSERT INTO user_events
       (user_id, owner_user_id, title, description, start_time, end_time, reminder_time, location, category, status)
     VALUES ($1,$1,$2,$3,$4,$5,$4,$6,$7,false)`,
    [
      userId,
      title,
      parsed.description || null,
      startIso,
      startIso,
      location,
      parsed.category || null
    ]
  )
  const humanTime = formatTaipeiDateTime(startIso)
  return `好的，我已經幫你記下提醒：「${title}」，時間在 ${humanTime}。`
}

const parseEventDetails = async (input, previous = {}) => {
  const parsed = await classifyReminder({ rawText: input, tz: TAIPEI_TZ }).catch(() => ({}))
  const title = (parsed.title || previous.title || '').trim()
  const detectedDate = parsed.date || detectDateFromText(input) || previous.date || ''
  const date = detectedDate
  const time = parsed.time || previous.time || ''
  const location = (parsed.location || extractLocationFromText(input) || previous.location || '').trim()
  const description = (parsed.description || previous.description || '').trim()
  const startIso = date && time ? toTaipeiIso(date, time) : previous.startIso || null
  return { title, date, time, location, description, startIso }
}

const createFriendForumEvent = async ({ userId, details }) => {
  const title = (details.title || '好友活動').slice(0, 60)
  const description = details.description || '好友邀請活動'
  const startIso =
    details.startIso || (details.date && details.time ? toTaipeiIso(details.date, details.time) : null)
  if (!startIso) {
    throw new Error('missing_event_time')
  }
  const location = details.location ? details.location.trim() : null

  const insert = await pool.query(
    `INSERT INTO elder_friend_events (host_user_id, title, description, start_time, location)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING event_id`,
    [userId, title, description, startIso, location]
  )
  const eventId = insert.rows[0].event_id

  await pool.query(
    `INSERT INTO elder_friend_event_participants (event_id, user_id, status)
     VALUES ($1,$2,'going')
     ON CONFLICT (event_id, user_id) DO NOTHING`,
    [eventId, userId]
  )

  const friendIds = await fetchFriendIds(userId)
  let invited = 0
  if (friendIds.length) {
    const inviteSql = `
      INSERT INTO elder_friend_event_participants (event_id, user_id, status)
      VALUES ($1,$2,'invited')
      ON CONFLICT (event_id, user_id)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
    `
    for (const fid of friendIds) {
      await pool.query(inviteSql, [eventId, fid])
      invited += 1
    }
  }

  return {
    eventId,
    title,
    startIso,
    location,
    invitedCount: invited
  }
}

const createReminderFromEvent = async ({ userId, details }) => {
  const startIso =
    details.startIso || (details.date && details.time ? toTaipeiIso(details.date, details.time) : null)
  if (!startIso) {
    throw new Error('missing_reminder_time')
  }
  const title = (details.title || '好友活動').slice(0, 60)
  const location = details.location ? details.location.trim() : null
  await pool.query(
    `INSERT INTO user_events
       (user_id, owner_user_id, title, description, start_time, end_time, reminder_time, location, category, status)
     VALUES ($1,$1,$2,$3,$4,$5,$4,$6,$7,false)`,
    [
      userId,
      title,
      details.description || '好友活動提醒',
      startIso,
      startIso,
      location,
      'friend_event'
    ]
  )
}

const beginEventWizard = async ({ userId, initialInput }) => {
  eventWizardSessions.set(userId, { stage: 'await_details', details: {} })
  if (!initialInput || !initialInput.trim()) {
    return '好的，我們來發起一場活動。請先告訴我活動名稱、日期與時間，如果有地點也一起說。'
  }
  return continueEventWizard({ userId, transcript: initialInput })
}

const continueEventWizard = async ({ userId, transcript }) => {
  const session = eventWizardSessions.get(userId)
  if (!session) return null

  const trimmed = (transcript || '').trim()
  const normalized = trimmed.replace(/\s+/g, '')

  if (normalized.includes('取消') || normalized.includes('先不用')) {
    eventWizardSessions.delete(userId)
    return '好的，已經為你取消這次的活動建立流程，有需要再叫我。'
  }

  if (session.stage === 'await_details') {
    if (!trimmed) {
      return '請跟我說活動的名稱、日期時間與地點，這樣我才能幫你記錄。'
    }
    const details = await parseEventDetails(trimmed, session.details || {})
    session.details = details
    eventWizardSessions.set(userId, session)
    const missing = []
    if (!details.title) missing.push('活動名稱')
    if (!details.date) missing.push('日期')
    if (!details.time) missing.push('時間')
    if (missing.length) {
      return `目前還缺少 ${missing.join('、')}，請再補充一次。`
    }
    if (!details.startIso) {
      return '我沒有聽懂活動的時間，請再說一次日期與時間。'
    }
    session.stage = 'await_confirm'
    eventWizardSessions.set(userId, session)
    const whenText = formatTaipeiDateTime(details.startIso)
    const locationText = details.location ? `，地點在 ${details.location}` : '（地點尚未設定）'
    return `這場活動叫做「${details.title}」，時間是 ${whenText}${locationText}。請說「確認活動」開始邀請好友，或說「我要修改」重新提供資料。`
  }

  if (session.stage === 'await_confirm') {
    if (normalized.includes('修改')) {
      session.stage = 'await_details'
      eventWizardSessions.set(userId, session)
      return '沒問題，我們重新調整，請再次告訴我活動名稱、日期、時間或地點。'
    }
    const confirmKeywords = ['確認', '好', '可以', '沒問題', 'ＯＫ', 'OK']
    const isConfirm = confirmKeywords.some(keyword => normalized.includes(keyword))
    if (!isConfirm) {
      return '準備好後請說「確認活動」，或說「取消」離開。'
    }
    try {
      const eventInfo = await createFriendForumEvent({ userId, details: session.details })
      session.stage = 'await_reminder_choice'
      eventWizardSessions.set(userId, session)
      const timeText = formatTaipeiDateTime(eventInfo.startIso)
      const locationText = eventInfo.location ? `，地點在 ${eventInfo.location}` : ''
      return `活動「${eventInfo.title}」已建立，時間 ${timeText}${locationText}，我也邀請了好友們。要不要把這個活動加到備忘錄提醒裡？請回答「要」或「不要」。`
    } catch (error) {
      eventWizardSessions.delete(userId)
      console.error('[event wizard] create event failed', error)
      return '建立活動時出了點問題，稍後再試試看。'
    }
  }

  if (session.stage === 'await_reminder_choice') {
    if (/不要|不用|否/.test(normalized)) {
      eventWizardSessions.delete(userId)
      return '了解，不會放進備忘錄。活動資訊已經同步到好友論壇。'
    }
    if (/要|好|加/.test(normalized)) {
      try {
        await createReminderFromEvent({ userId, details: session.details })
        eventWizardSessions.delete(userId)
        return '已把這個活動加入備忘錄，到時候會再提醒你。'
      } catch (error) {
        eventWizardSessions.delete(userId)
        console.error('[event wizard] reminder failed', error)
        return '活動已建立，但新增備忘錄失敗，稍後再試一次。'
      }
    }
    return '這個活動要不要同步到備忘錄提醒？請說「要」或「不要」。'
  }

  return null
}


const handleAddFriend = async (text, userId) => {
  const digits = digitsFromText(text)
  const normalizedPhone = normalizePhone(digits)
  if (!normalizedPhone) {
    return '我沒有聽懂電話號碼，請用十位數字再說一次。'
  }
  const target = await pool.query(
    'SELECT user_id, full_name, username, charactor FROM users WHERE phone = $1 LIMIT 1',
    [normalizedPhone]
  )
  if (target.rowCount === 0) {
    return '找不到這個電話的朋友，請確認後再說一次。'
  }
  const targetUser = target.rows[0]
  if (targetUser.user_id === userId) {
    return '無法將自己加入好友喔。'
  }

  if (normalizeRole(targetUser.charactor) !== 'elder') {
    return '這位朋友不是長輩帳號，無法加入好友。'
  }

  const existing = await pool.query(
    `SELECT friendship_id, status
     FROM elder_friendships
     WHERE (requester_id = $1 AND addressee_id = $2)
        OR (requester_id = $2 AND addressee_id = $1)
     LIMIT 1`,
    [userId, targetUser.user_id]
  )
  if (existing.rowCount) {
    const record = existing.rows[0]
    if (record.status === 'pending') return '已經送過邀請囉，等對方回覆就可以了。'
    if (record.status === 'accepted') return '你們已經是好友了！'
  }

  const currentCount = await handleFriendLimitCheck(userId)
  if (currentCount >= FRIEND_LIMIT) {
    return `好友上限是 ${FRIEND_LIMIT} 位，如果要再加朋友，可以先刪除一位現有好友。`
  }
  const targetCount = await handleFriendLimitCheck(targetUser.user_id)
  if (targetCount >= FRIEND_LIMIT) {
    return '對方的好友名單已滿，目前無法新增。'
  }

  await pool.query(
    `INSERT INTO elder_friendships (requester_id, addressee_id, status)
     VALUES ($1,$2,'pending')`,
    [userId, targetUser.user_id]
  )

  const name = targetUser.full_name || targetUser.username || `User ${targetUser.user_id}`
  return `已送出好友邀請給 ${name}，等他回覆後我會再提醒你。`
}

const describeInviteList = (rows, label) => {
  if (!rows.length) {
    return `目前沒有${label}。`
  }
  const lines = rows.slice(0, 3).map((row, index) => {
    const name = row.full_name || row.username || `User ${row.requester_id || row.event_id}`
    const phone = row.phone ? `，電話 ${row.phone}` : ''
    const extra = row.start_time ? `，時間在 ${formatTaipeiDateTime(row.start_time)}` : ''
    const place = row.location ? `，地點 ${row.location}` : ''
    return `第 ${index + 1} 位：${name}${phone}${extra}${place}`
  })
  return `${label}共有 ${rows.length} 筆。\n${lines.join('\n')}\n請說「我要接受好友邀請一」或「我要拒絕好友邀請一」來決定。`
}

const handleFriendInvites = async (userId) => {
  const rows = await fetchPendingFriendInvites(userId)
  return describeInviteList(rows, '好友邀請')
}

const updateFriendInviteStatus = async (userId, intent, index) => {
  const invites = await fetchPendingFriendInvites(userId)
  if (!invites.length) return '目前沒有好友邀請喔。'
  const targetIndex = Number.isFinite(index) && index > 0 ? index - 1 : 0
  const invite = invites[targetIndex] || invites[0]
  const newStatus = intent === 'accept' ? 'accepted' : 'declined'
  await pool.query(
    'UPDATE elder_friendships SET status = $1, responded_at = now(), updated_at = now() WHERE friendship_id = $2',
    [newStatus, invite.friendship_id]
  )
  if (newStatus === 'accepted') {
    return `已接受 ${invite.full_name || '對方'} 的好友邀請。`
  }
  return `已婉拒 ${invite.full_name || '對方'} 的好友邀請。`
}

const handleActivityInvites = async (userId) => {
  const rows = await fetchPendingActivityInvites(userId)
  if (!rows.length) return '目前沒有活動邀請。'
  const lines = rows.slice(0, 3).map((row, index) => {
    const host = row.host_name ? `由 ${row.host_name} 發起` : '有人邀請'
    const when = formatTaipeiDateTime(row.start_time)
    const where = row.location ? `，地點 ${row.location}` : ''
    return `第 ${index + 1} 場：${row.title || '活動'}，${host}，時間 ${when}${where}`
  })
  return `共有 ${rows.length} 場活動邀請。\n${lines.join('\n')}\n想參加請說「我要參加活動一」，若不想參加則說「我要取消活動一」。`
}

const updateActivityInvite = async (userId, intent, index) => {
  const invites = await fetchPendingActivityInvites(userId)
  if (!invites.length) return '目前沒有活動邀請喔。'
  const targetIndex = Number.isFinite(index) && index > 0 ? index - 1 : 0
  const invite = invites[targetIndex] || invites[0]
  const newStatus = intent === 'accept' ? 'going' : 'declined'
  await pool.query(
    `UPDATE elder_friend_event_participants
        SET status = $1, updated_at = now()
      WHERE event_id = $2 AND user_id = $3`,
    [newStatus, invite.event_id, userId]
  )
  if (newStatus === 'going') {
    return `已回覆參加「${invite.title}」。`
  }
  return `已婉拒「${invite.title}」。`
}

const handleCreateActivity = async (text, userId) => {
  const parsed = await classifyReminder({ rawText: text, tz: TAIPEI_TZ }).catch(() => ({}))
  const details = {
    title: (parsed.title || '好友活動').slice(0, 60),
    date: parsed.date || detectDateFromText(text) || '',
    time: parsed.time || '',
    location: parsed.location || extractLocationFromText(text) || '',
    description: parsed.description || '好友邀請活動',
    startIso: null
  }
  if (details.date && details.time) {
    details.startIso = toTaipeiIso(details.date, details.time)
  }
  if (!details.startIso) {
    return '我沒有聽懂活動時間，請再說一次日期與時間。'
  }
  try {
    const eventInfo = await createFriendForumEvent({ userId, details })
    const when = formatTaipeiDateTime(eventInfo.startIso)
    const locationText = eventInfo.location ? `，地點 ${eventInfo.location}` : ''
    return `已經幫你建立「${eventInfo.title}」，時間在 ${when}${locationText}，我也通知好友囉。`
  } catch (error) {
    console.error('[handleCreateActivity] failed', error)
    return '建立活動時出了點狀況，稍後再試試看。'
  }
}

const handleViewReminders = async (userId) => {
  const events = await fetchTodayReminders(userId)
  if (!events.length) {
    return '今天行程很清爽，沒有任何提醒。'
  }
  const lines = events.slice(0, 5).map((event, index) => {
    const when = formatTaipeiDateTime(event.start_time)
    const place = event.location ? `，地點 ${event.location}` : ''
    return `第 ${index + 1} 件：${event.title}，時間 ${when}${place}`
  })
  return `今天共有 ${events.length} 件提醒：\n${lines.join('\n')}。`
}

const handleCompletionCheck = async (userId) => {
  const pending = await fetchExpiredReminders(userId)
  if (!pending.length) {
    return '今天的提醒都完成了，辛苦了！'
  }
  const lines = pending.slice(0, 3).map((event, index) => {
    const when = formatTaipeiDateTime(event.start_time)
    return `第 ${index + 1} 件「${event.title}」，時間 ${when}`
  })
  return `今天還有 ${pending.length} 件提醒等待確認：\n${lines.join('\n')}。\n若已完成，可說「我完成提醒一」。`
}

const handleMarkCompletion = async (userId, text) => {
  const numberMatch = text.match(/([一二三四五六七八九十\d]+)/)
  let index = 1
  if (numberMatch) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
    const token = numberMatch[1]
    if (map[token] !== undefined) index = map[token]
    else if (Number.isFinite(Number(token))) index = Number(token)
  }
  const pending = await fetchExpiredReminders(userId)
  if (!pending.length) return '目前沒有需要確認的提醒。'
  const targetIndex = index > 0 ? index - 1 : 0
  const target = pending[targetIndex] || pending[0]
  await pool.query('UPDATE user_events SET status = true, updated_at = now() WHERE id = $1', [target.id])
  return `了解，「${target.title}」已標記完成，做得好！`
}

const maybeHandleElderVoiceCommand = async ({ transcript, viewer, userId }) => {
  if (!transcript) return null
  const role = normalizeRole(viewer?.charactor)
  if (role !== 'elder') return null
  const compact = transcript.trim()
  if (!compact) return null

  const normalized = compact.replace(/\s+/g, '')
  if (normalized.startsWith('我要發起活動')) {
    const remainder = compact.replace(/^我要發起活動/, '').trim()
    const responseText = await beginEventWizard({ userId, initialInput: remainder })
    return { responseText }
  }

  const wizardSession = eventWizardSessions.get(userId)
  if (wizardSession) {
    const responseText = await continueEventWizard({ userId, transcript: compact })
    return { responseText }
  }

  if (normalized.includes('我要加好友')) {
    const responseText = await handleAddFriend(compact, userId)
    return { responseText }
  }

  if (normalized.includes('我要看好友邀請')) {
    const responseText = await handleFriendInvites(userId)
    return { responseText }
  }

  if (normalized.match(/我要(接受|確認)好友邀請/)) {
    const match = compact.match(/邀請(?:第)?(\d+|[一二三四五六七八九十])/)
    let index
    if (match) {
      const token = match[1]
      const numMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
      index = numMap[token] ?? Number(token)
    }
    const responseText = await updateFriendInviteStatus(userId, 'accept', index)
    return { responseText }
  }

  if (normalized.match(/我要(拒絕|取消)好友邀請/)) {
    const match = compact.match(/邀請(?:第)?(\d+|[一二三四五六七八九十])/)
    let index
    if (match) {
      const token = match[1]
      const numMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
      index = numMap[token] ?? Number(token)
    }
    const responseText = await updateFriendInviteStatus(userId, 'decline', index)
    return { responseText }
  }

  if (normalized.includes('我要看活動邀請')) {
    const responseText = await handleActivityInvites(userId)
    return { responseText }
  }

  if (normalized.match(/我要(參加|確認)活動/)) {
    const match = compact.match(/活動(?:第)?(\d+|[一二三四五六七八九十])/)
    let index
    if (match) {
      const numMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
      const token = match[1]
      index = numMap[token] ?? Number(token)
    }
    const responseText = await updateActivityInvite(userId, 'accept', index)
    return { responseText }
  }

  if (normalized.match(/我要(拒絕|取消|不要)活動/)) {
    const match = compact.match(/活動(?:第)?(\d+|[一二三四五六七八九十])/)
    let index
    if (match) {
      const numMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
      const token = match[1]
      index = numMap[token] ?? Number(token)
    }
    const responseText = await updateActivityInvite(userId, 'decline', index)
    return { responseText }
  }

  if (normalized.includes('語音備忘錄') || normalized.includes('幫我記') || normalized.includes('提醒我')) {
    const responseText = await handleCreateReminder(compact, userId)
    return { responseText }
  }

  if (normalized.includes('今天有什麼事要做') || normalized.includes('今天要做什麼')) {
    const responseText = await handleViewReminders(userId)
    return { responseText }
  }

  if (normalized.includes('今天有沒有達成')) {
    const responseText = await handleCompletionCheck(userId)
    return { responseText }
  }

  if (normalized.includes('我完成') || normalized.includes('我已完成') || normalized.includes('我達成')) {
    const responseText = await handleMarkCompletion(userId, compact)
    return { responseText }
  }

  return null
}

const router = express.Router()
router.use(withCookies)

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      persona = 'senior',
      audio,
      message,
      context,
      facebookPosts,
      speechConfig = {}
    } = req.body

    if (!audio && !message) {
      return res.status(400).json({
        error: '缺少語音或文字訊息'
      })
    }

    let transcript = message
    let stt

    if (!transcript && audio) {
      stt = await transcribeAudio({
        audioContent: audio.content,
        languageCode: audio.languageCode ?? 'zh-TW',
        encoding: audio.encoding ?? 'LINEAR16',
        sampleRateHertz: audio.sampleRateHertz ?? 16000
      })
      transcript = stt.transcript
    }

    if (!transcript) {
      return res.status(422).json({
        error: '語音辨識失敗，無法取得文字內容'
      })
    }

    const viewer = await fetchUserRelation(req.userId).catch(() => null)
    const elderContextId = resolveElderIdForUser(viewer) ?? req.userId

    const commandResult = await maybeHandleElderVoiceCommand({
      transcript,
      viewer,
      userId: req.userId
    })

    if (commandResult) {
      const personaInfo = getPersona(persona)
      const proactive = await buildProactiveNote(req.userId)
      const baseText = commandResult.responseText || '已經幫你處理好了。'
      const responseText = proactive ? `${baseText}\n${proactive}` : baseText
      const tts = await synthesizeSpeech({
        text: responseText,
        inputType: speechConfig.inputType ?? 'text',
        languageCode: speechConfig.languageCode ?? 'zh-TW',
        voiceName: speechConfig.voiceName,
        speakingRate: speechConfig.speakingRate ?? 1,
        pitch: speechConfig.pitch ?? 1,
        energy: speechConfig.energy ?? 1,
        encoding: speechConfig.encoding,
        sampleRate: speechConfig.sampleRate
      })

      return res.json({
        persona: personaInfo,
        transcript,
        stt,
        responseText,
        audio: tts
      })
    }

    let postsForContext = Array.isArray(facebookPosts) ? facebookPosts : []
    if (!postsForContext.length) {
      try {
        postsForContext = await getFriendPosts({ limit: 3, elderId: elderContextId })
      } catch (error) {
        if (error.code !== 'FACEBOOK_CONFIG_MISSING') {
          console.warn('[AI Companion] 取得 Facebook 貼文失敗：', error.message)
        }
      }
    }

    const companionStyles = await fetchCompanionStyleHints(elderContextId)

    const normalizedContext = sanitizeContext(context)
    const facebookSummary = summarizeFacebookPosts(postsForContext)
    if (facebookSummary) {
      normalizedContext.push({
        role: 'system',
        text: facebookSummary
      })
    }

    const reply = await generateChatResponse({
      personaKey: persona,
      message: transcript,
      context: normalizedContext,
      companionStyles
    })

    let replyText = (reply.text ?? '').trim() || '抱歉，我目前想不到合適的回應，請再說一次。'

    if (normalizeRole(viewer?.charactor) === 'elder') {
      const proactive = await buildProactiveNote(req.userId)
      if (proactive) {
        replyText = `${replyText}\n${proactive}`
      }
    }

    const tts = await synthesizeSpeech({
      text: replyText,
      inputType: speechConfig.inputType ?? 'text',
      languageCode: speechConfig.languageCode ?? 'zh-TW',
      voiceName: speechConfig.voiceName,
      speakingRate: speechConfig.speakingRate ?? 1,
      pitch: speechConfig.pitch ?? 1,
      energy: speechConfig.energy ?? 1,
      encoding: speechConfig.encoding,
      sampleRate: speechConfig.sampleRate
    })

    const elderProfile = await fetchElderProfile(elderContextId).catch(() => null)
    if (elderProfile) {
      try {
        if (transcript && transcript.trim()) {
          await recordChatEntry({
            elder: elderProfile,
            createdBy: req.userId,
            message: transcript,
            role: 'user'
          })
        }
        if (replyText && replyText.trim()) {
          await recordChatEntry({
            elder: elderProfile,
            createdBy: req.userId,
            message: replyText,
            role: 'ai'
          })
        }
      } catch (styleError) {
        console.warn('[chat] companion style chat log failed', styleError.message)
      }
    }

    res.json({
      persona: reply.persona,
      transcript,
      stt,
      responseText: replyText,
      audio: tts
    })
  } catch (error) {
    next(error)
  }
})

export default router

// Lightweight endpoint for refining reminder titles using LLM.
router.post('/refine-title', async (req, res, next) => {
  try {
    const { rawText, hints } = req.body || {}
    if (!rawText || typeof rawText !== 'string') {
      return res.status(400).json({ error: 'invalid_payload' })
    }
    const title = await refineReminderTitle({ rawText, hints })
    return res.json({ title })
  } catch (error) {
    next(error)
  }
})

// Extract reminder fields (title/date/time/location/category/description) from raw text
router.post('/classify', async (req, res, next) => {
  try {
    const { rawText, tz } = req.body || {}
    if (!rawText || typeof rawText !== 'string') {
      return res.status(400).json({ error: 'invalid_payload' })
    }
    const data = await classifyReminder({ rawText, tz: tz || 'Asia/Taipei' })
    return res.json(data)
  } catch (error) {
    next(error)
  }
})
const fetchCompanionStyleHints = async (elderId) => {
  if (!Number.isFinite(elderId)) return []
  try {
    const { rows } = await pool.query(
      `SELECT interest
       FROM companion_styles
       WHERE elder_user_id = $1 AND entry_type = 'interest'
       ORDER BY created_at DESC
       LIMIT $2`,
      [elderId, COMPANION_STYLE_LIMIT]
    )
    return rows
      .map((row) => (row.interest || '').toString().trim())
      .filter(Boolean)
  } catch (error) {
    console.warn('[chat] 讀取 companion styles 失敗：', error.message)
    return []
  }
}
