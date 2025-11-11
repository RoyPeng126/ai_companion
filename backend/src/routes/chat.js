import express from 'express'
import { transcribeAudio } from '../services/speechService.js'
import { generateChatResponse, refineReminderTitle, classifyReminder } from '../services/geminiService.js'
import { synthesizeSpeech } from '../services/ttsService.js'
import { getFriendPosts } from '../services/facebookService.js'
import { withCookies, requireAuth } from '../middleware/auth.js'
import { fetchUserRelation, resolveElderIdForUser } from '../utils/family.js'

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

    let postsForContext = Array.isArray(facebookPosts) ? facebookPosts : []
    if (!postsForContext.length) {
      try {
        const viewer = await fetchUserRelation(req.userId).catch(() => null)
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

    const replyText = (reply.text ?? '').trim() || '抱歉，我目前想不到合適的回應，請再說一次。'

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
