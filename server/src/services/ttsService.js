import textToSpeech from '@google-cloud/text-to-speech'

let client

const getClient = () => {
  if (!client) {
    client = new textToSpeech.TextToSpeechClient()
  }
  return client
}

export const synthesizeSpeech = async ({
  text,
  languageCode = 'zh-TW',
  voiceName,
  speakingRate = 0.9
}) => {
  if (!text) {
    throw new Error('缺少要轉換的文字內容')
  }

  const request = {
    input: { text },
    voice: {
      languageCode,
      name: voiceName,
      ssmlGender: 'FEMALE'
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate,
      pitch: -1.4
    }
  }

  const [response] = await getClient().synthesizeSpeech(request)
  return {
    audioContent: response.audioContent.toString('base64')
  }
}
