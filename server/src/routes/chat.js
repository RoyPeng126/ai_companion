import express from 'express'
import { transcribeAudio } from '../services/speechService.js'
import { generateChatResponse } from '../services/geminiService.js'
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
        encoding: audio.encoding ?? 'WEBM_OPUS',
        sampleRateHertz: audio.sampleRateHertz
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

    const tts = await synthesizeSpeech({
      text: reply.text,
      languageCode: speechConfig.languageCode ?? 'zh-TW',
      voiceName: speechConfig.voiceName,
      speakingRate: speechConfig.speakingRate ?? 0.9
    })

    res.json({
      persona: reply.persona,
      transcript,
      stt,
      responseText: reply.text,
      audio: tts
    })
  } catch (error) {
    next(error)
  }
})

export default router
