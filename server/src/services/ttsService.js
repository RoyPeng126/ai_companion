import '../config/env.js'

const API_HOST = (process.env.TTS_API_HOST ?? 'https://tts.api.yating.tw').replace(/\/$/, '')
const API_KEY = process.env.TTS_API_KEY
const DEFAULT_MODEL = process.env.TTS_VOICE_MODEL ?? 'zh_en_female_1'
const DEFAULT_ENCODING = process.env.TTS_AUDIO_ENCODING ?? 'LINEAR16'
const DEFAULT_SAMPLE_RATE = process.env.TTS_AUDIO_SAMPLE_RATE ?? '22K'

const clampNumber = (value, { min = 0.5, max = 1.5, fallback = 1 }) => {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return Math.min(max, Math.max(min, num))
}

const mapEncodingToMime = (encoding) => {
  if (!encoding) return 'audio/wav'
  const normalized = String(encoding).toUpperCase()
  if (normalized === 'MP3') return 'audio/mpeg'
  return 'audio/wav'
}

const buildRequestBody = ({
  text,
  inputType,
  voiceName,
  speakingRate,
  pitch,
  energy,
  encoding,
  sampleRate
}) => ({
  input: {
    text,
    type: inputType
  },
  voice: {
    model: voiceName,
    speed: clampNumber(speakingRate, { min: 0.5, max: 1.5, fallback: 1 }),
    pitch: clampNumber(pitch, { min: 0.5, max: 1.5, fallback: 1 }),
    energy: clampNumber(energy, { min: 0.5, max: 1.5, fallback: 1 })
  },
  audioConfig: {
    encoding,
    sampleRate
  }
})

const parseErrorResponse = async (response) => {
  try {
    return await response.json()
  } catch (_) {
    const text = await response.text()
    return { error: text }
  }
}

const createTimeoutSignal = (ms) => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('fetch timeout')), ms)
  if (typeof timeout.unref === 'function') {
    timeout.unref()
  }
  return controller.signal
}

export const synthesizeSpeech = async ({
  text,
  inputType = 'text',
  languageCode = 'zh-TW',
  voiceName,
  speakingRate = 1,
  pitch = 1,
  energy = 1,
  encoding = DEFAULT_ENCODING,
  sampleRate = DEFAULT_SAMPLE_RATE
}) => {
  if (!text) {
    throw new Error('缺少要轉換的文字內容')
  }

  if (!API_KEY) {
    throw new Error('尚未設定 TTS_API_KEY，請於環境變數中提供 Yating TTS API 金鑰')
  }

  const model = voiceName || DEFAULT_MODEL
  if (!model) {
    throw new Error('缺少 TTS 聲音模型，請於請求或環境變數 TTS_VOICE_MODEL 中設定')
  }

  const body = buildRequestBody({
    text,
    inputType,
    voiceName: model,
    speakingRate,
    pitch,
    energy,
    encoding,
    sampleRate
  })

  const response = await fetch(`${API_HOST}/v2/speeches/short`, {
    method: 'POST',
    headers: {
      key: API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: createTimeoutSignal(120_000)
  })

  if (!response.ok) {
    const errorPayload = await parseErrorResponse(response)
    throw new Error(
      `語音合成服務回應錯誤 (${response.status}): ${JSON.stringify(errorPayload)}`
    )
  }

  const payload = await response.json()

  if (!payload?.audioContent) {
    throw new Error('語音合成服務未返回音訊內容')
  }

  const mimeType = mapEncodingToMime(payload.audioConfig?.encoding ?? encoding)

  return {
    audioContent: payload.audioContent,
    contentType: mimeType,
    voice: model,
    languageCode,
    audioConfig: payload.audioConfig ?? { encoding, sampleRate }
  }
}
