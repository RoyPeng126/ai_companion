import { GoogleGenerativeAI } from '@google/generative-ai'
import { getPersona } from '../utils/personas.js'

let client

const getClient = () => {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('缺少 GEMINI_API_KEY，無法呼叫聊天服務')
  }
  if (!client) {
    client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  }
  return client
}

export const generateChatResponse = async ({
  personaKey,
  message,
  context = []
}) => {
  if (!message) {
    throw new Error('缺少訊息內容，無法產生回覆')
  }

  const persona = getPersona(personaKey)
  const genAI = getClient()
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' })

  const history = context.map(item => ({
    role: item.role,
    parts: [{ text: item.text }]
  }))

  const chat = model.startChat({
    history: [
      {
        role: 'user',
        parts: [{ text: persona.prompt }]
      },
      ...history
    ],
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      maxOutputTokens: 512
    }
  })

  const result = await chat.sendMessage(message)
  const responseText = result.response.text()

  return {
    persona,
    text: responseText
  }
}
