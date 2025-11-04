import express from 'express'
import { transcribeAudio } from '../services/speechService.js'
import { generateChatResponse, refineReminderTitle } from '../services/geminiService.js'
import { synthesizeSpeech } from '../services/ttsService.js'

const router = express.Router()

router.post('/', async (req, res, next) => {
  try {
    const {
      persona = 'senior',
      audio,
      message,
      context,
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

    const reply = await generateChatResponse({
      personaKey: persona,
      message: transcript,
      context
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
