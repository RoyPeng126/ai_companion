import { SpeechClient } from '@google-cloud/speech'

let speechClient

const getSpeechClient = () => {
  if (!speechClient) {
    const options = {}
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      try {
        options.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)
      } catch (error) {
        throw new Error('語音服務認證設定錯誤，請確認 GOOGLE_APPLICATION_CREDENTIALS_JSON 為有效的 JSON 字串')
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      options.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS
    }
    speechClient = new SpeechClient(options)
  }
  return speechClient
}

const normalizeSampleRate = (value) => {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const rate = Number(value)
  return Number.isFinite(rate) ? rate : undefined
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

  try {
    const client = getSpeechClient()
    const targetSampleRate =
      normalizeSampleRate(sampleRateHertz) ??
      normalizeSampleRate(process.env.STT_SAMPLE_RATE)

    const [response] = await client.recognize({
      audio: { content: audioContent },
      config: {
        languageCode: languageCode ?? process.env.STT_LANGUAGE_CODE ?? 'zh-TW',
        enableAutomaticPunctuation: true,
        encoding: encoding ?? process.env.STT_ENCODING ?? 'WEBM_OPUS',
        ...(targetSampleRate ? { sampleRateHertz: targetSampleRate } : {}),
        ...(model
          ? { model }
          : process.env.STT_MODEL
            ? { model: process.env.STT_MODEL }
            : {})
      }
    })
    const result = response.results?.[0]?.alternatives?.[0]
    const transcript = result?.transcript?.trim() ?? ''
    if (!transcript) {
      throw new Error('語音辨識完成但未偵測到文字內容')
    }
    return {
      transcript,
      confidence: result.confidence ?? null
    }
  } catch (error) {
    throw new Error(`語音辨識失敗：${error.message}`)
  }
}
