import '../config/env.js'
import axios from 'axios'
import WebSocket from 'ws'

const DEFAULT_TOKEN_URL = 'https://asr.api.yating.tw/v1/token'
const DEFAULT_WS_URL = 'wss://asr.api.yating.tw/ws/v1/'
const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_PIPELINE = 'asr-zh-en-std'
const DEFAULT_CHUNK_SIZE = 2000
const CONNECTION_TIMEOUT_MS = 45000

const milliseconds = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const resolvePipeline = ({ languageCode, override }) => {
  if (override && typeof override === 'string') {
    const trimmed = override.trim()
    if (/^asr[._-]/i.test(trimmed)) {
      return trimmed
    }
  }
  if (process.env.YATING_STT_PIPELINE) {
    return process.env.YATING_STT_PIPELINE.trim()
  }

  const code = (languageCode ?? process.env.STT_LANGUAGE_CODE ?? '').toLowerCase()
  if (code.startsWith('zh')) {
    if (code.includes('tw') || code.includes('zh-tw')) {
      return 'asr-zh-tw-std'
    }
    return 'asr-zh-en-std'
  }
  if (code.startsWith('en')) {
    return 'asr-en-std'
  }
  if (code.startsWith('ja') || code.startsWith('jp')) {
    return 'asr-jp-std'
  }
  return DEFAULT_PIPELINE
}

const requestOneTimeToken = async ({ pipeline, customModel }) => {
  const apiKey = process.env.YATING_STT_API_KEY
  if (!apiKey) {
    throw new Error('缺少 YATING_STT_API_KEY 設定，無法呼叫語音服務')
  }

  const tokenUrl = process.env.YATING_STT_TOKEN_URL?.trim() || DEFAULT_TOKEN_URL

  try {
    const payload = { pipeline }
    if (customModel) {
      payload.options = { s3CusModelKey: customModel }
    }

    const { data } = await axios.post(tokenUrl, payload, {
      headers: {
        key: apiKey,
        'Content-Type': 'application/json'
      },
      timeout: milliseconds(process.env.YATING_STT_TOKEN_TIMEOUT_MS, 10000)
    })

    if (!data?.success) {
      throw new Error(data?.detail || '語音服務回傳失敗，請確認 API Key 與 Pipeline 設定')
    }

    if (!data.auth_token) {
      throw new Error('語音服務未回傳有效的授權資訊')
    }

    return data.auth_token
  } catch (error) {
    const reason = error.response?.data?.detail || error.message
    throw new Error(`語音服務授權失敗：${reason}`)
  }
}

const sendAudioChunks = (ws, buffer) => {
  const chunkSize = Number(process.env.YATING_STT_CHUNK_SIZE ?? DEFAULT_CHUNK_SIZE)
  const size = Number.isFinite(chunkSize) && chunkSize > 0 ? chunkSize : DEFAULT_CHUNK_SIZE

  for (let offset = 0; offset < buffer.length; offset += size) {
    const chunk = buffer.subarray(offset, Math.min(offset + size, buffer.length))
    ws.send(chunk)
  }

  // Notify the ASR pipeline that no more audio frames will be sent.
  ws.send(new Uint8Array(0))
}

const streamTranscription = ({ token, audioBuffer }) => {
  const baseUrl = process.env.YATING_STT_WS_URL?.trim() || DEFAULT_WS_URL
  const url = new URL(baseUrl)
  url.searchParams.set('token', token)

  return new Promise((resolve, reject) => {
    let isSettled = false
    let lastSentence = ''
    let confidence = null
    let handshakeCompleted = false

    const ws = new WebSocket(url)

    const cleanup = (error, result) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timeoutId)
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close()
        }
      } catch (_) {}

      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }

    const timeoutId = setTimeout(() => {
      cleanup(new Error('語音辨識逾時，請稍後再試'))
    }, milliseconds(process.env.YATING_STT_TIMEOUT_MS, CONNECTION_TIMEOUT_MS))

    ws.addEventListener('error', (event) => {
      const reason = event?.message || '未知錯誤'
      cleanup(new Error(`語音服務連線失敗：${reason}`))
    })

    ws.addEventListener('close', () => {
      if (!isSettled) {
        cleanup(new Error('語音服務連線於取得結果前中斷'))
      }
    })

    ws.addEventListener('message', (event) => {
      let payloadText = ''

      if (typeof event.data === 'string') {
        payloadText = event.data
      } else if (event.data instanceof ArrayBuffer) {
        payloadText = Buffer.from(event.data).toString('utf8')
      } else if (ArrayBuffer.isView(event.data)) {
        payloadText = Buffer.from(event.data.buffer).toString('utf8')
      }

      if (!payloadText) return

      let message
      try {
        message = JSON.parse(payloadText)
      } catch (_) {
        return
      }

      if (message.status === 'error') {
        const detail = message.detail || '語音服務回傳錯誤'
        cleanup(new Error(detail))
        return
      }

      if (message.status === 'ok' && !handshakeCompleted) {
        handshakeCompleted = true
        try {
          sendAudioChunks(ws, audioBuffer)
        } catch (error) {
          cleanup(new Error(`音訊資料傳輸失敗：${error.message}`))
        }
        return
      }

      const pipe = message.pipe
      if (!pipe) return

      if (typeof pipe.asr_sentence === 'string') {
        lastSentence = pipe.asr_sentence
        if (pipe.asr_confidence !== undefined && pipe.asr_confidence !== null) {
          confidence = Number(pipe.asr_confidence)
        }
      }

      if (pipe.asr_final === true) {
        const transcript = (lastSentence || '').trim()
        if (!transcript) {
          cleanup(new Error('語音辨識完成但未偵測到文字內容'))
          return
        }
        cleanup(null, {
          transcript,
          confidence: Number.isFinite(confidence) ? confidence : null
        })
      }
    })
  })
}

export const transcribeAudio = async ({
  audioContent,
  languageCode,
  encoding,
  sampleRateHertz,
  model
}) => {
  if (!audioContent) {
    throw new Error('缺少音訊內容，無法進行語音辨識')
  }

  const pcmBuffer = Buffer.from(audioContent, 'base64')
  if (!pcmBuffer.length) {
    throw new Error('音訊內容為空，無法進行語音辨識')
  }

  const sampleRate = Number(sampleRateHertz || process.env.YATING_STT_SAMPLE_RATE || DEFAULT_SAMPLE_RATE)
  if (sampleRate !== DEFAULT_SAMPLE_RATE) {
    throw new Error('目前僅支援 16kHz 的 PCM 音訊，請調整錄音設定')
  }

  const normalizedEncoding = (encoding || 'LINEAR16').toUpperCase()
  if (normalizedEncoding !== 'LINEAR16' && normalizedEncoding !== 'PCM16LE') {
    throw new Error('目前僅支援 16-bit PCM 音訊格式 (LINEAR16)')
  }

  try {
    const pipeline = resolvePipeline({ languageCode, override: model })
    const token = await requestOneTimeToken({
      pipeline,
      customModel: process.env.YATING_STT_CUSTOM_MODEL?.trim()
    })
    return await streamTranscription({
      token,
      audioBuffer: pcmBuffer
    })
  } catch (error) {
    throw new Error(`語音辨識失敗：${error.message}`)
  }
}
