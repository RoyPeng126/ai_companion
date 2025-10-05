import { SpeechClient } from '@google-cloud/speech'

let client

const getClient = () => {
  if (!client) {
    client = new SpeechClient()
  }
  return client
}

export const transcribeAudio = async ({
  audioContent,
  languageCode = 'zh-TW',
  encoding = 'WEBM_OPUS',
  sampleRateHertz
}) => {
  if (!audioContent) {
    throw new Error('缺少音訊內容，無法進行語音辨識')
  }

  const request = {
    audio: { content: audioContent },
    config: {
      encoding,
      languageCode,
      enableAutomaticPunctuation: true,
      model: 'default',
      sampleRateHertz
    }
  }

  const [response] = await getClient().recognize(request)
  const transcript = response.results
    .map(result => result.alternatives[0]?.transcript)
    .filter(Boolean)
    .join('\n')

  return {
    transcript,
    confidence: response.results[0]?.alternatives[0]?.confidence ?? null
  }
}
