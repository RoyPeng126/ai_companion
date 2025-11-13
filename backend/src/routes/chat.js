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
const TAIPEI_TZ = 'Asia/Taipei'

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
  const dateStr = parsed.date || toTaipeiDateString()
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
  const dateStr = parsed.date || toTaipeiDateString()
  const timeStr = parsed.time || '10:00'
  const startIso = toTaipeiIso(dateStr, timeStr)
  if (!startIso) {
    return '我沒有聽懂活動時間，請再說一次日期與時間。'
  }
  const title = (parsed.title || '好友活動').slice(0, 60)
  const location = parsed.location || extractLocationFromText(text) || null
  const description = parsed.description || '好友邀請活動'

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
  if (friendIds.length) {
    const inviteSql = `
      INSERT INTO elder_friend_event_participants (event_id, user_id, status)
      VALUES ($1,$2,'invited')
      ON CONFLICT (event_id, user_id)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
    `
    for (const fid of friendIds) {
      await pool.query(inviteSql, [eventId, fid])
    }
  }

  const when = formatTaipeiDateTime(startIso)
  return `已經幫你建立「${title}」，時間在 ${when}${location ? `，地點 ${location}` : ''}，我也通知好友囉。`
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
  const lower = compact.toLowerCase()

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

  if (normalized.includes('我要發起活動')) {
    const responseText = await handleCreateActivity(compact.replace('我要發起活動', ''), userId)
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
        const elderContextId = resolveElderIdForUser(viewer) ?? req.userId
        postsForContext = await getFriendPosts({ limit: 3, elderId: elderContextId })
      } catch (error) {
        if (error.code !== 'FACEBOOK_CONFIG_MISSING') {
          console.warn('[AI Companion] 取得 Facebook 貼文失敗：', error.message)
        }
      }
    }

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
      context: normalizedContext
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
