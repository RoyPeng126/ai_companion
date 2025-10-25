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
  const personaPrompt = `${persona.prompt}\n回覆請精簡自然，最多兩句話，每句不超過 20 個字。`
  const genAI = getClient()
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest'
  const requestOptions = process.env.GEMINI_API_VERSION
    ? { apiVersion: process.env.GEMINI_API_VERSION }
    : undefined
  const model = genAI.getGenerativeModel(
    { model: modelName },
    requestOptions
  )

  const fullHistory = context.map(item => ({
    role: item.role,
    parts: [{ text: item.text }]
  }))

  const historyVariants = [
    fullHistory,
    fullHistory.slice(-6),
    fullHistory.slice(-2),
    []
  ]

  const maxTokensEnv = Number.parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? '', 10)
  const baseGenerationConfig = {
    temperature: 0.6,
    topP: 0.9,
    responseMimeType: 'text/plain'
  }

  let baseMaxOutputTokens = 512
  if (Number.isFinite(maxTokensEnv) && maxTokensEnv > 0) {
    const safeMin = 512
    baseMaxOutputTokens = Math.max(safeMin, maxTokensEnv)
    if (baseMaxOutputTokens !== maxTokensEnv) {
      console.warn(`[AI Companion] GEMINI_MAX_OUTPUT_TOKENS=${maxTokensEnv} 過低，已自動調整為 ${baseMaxOutputTokens}。`)
    }
  }

  const maxTokenVariants = Array.from(
    new Set(
      [
        baseMaxOutputTokens,
        768,
        1024,
        1536,
        2048,
        3072,
        4096
      ].filter(limit => limit && limit >= baseMaxOutputTokens)
    )
  )

  const tryGenerate = async (history, maxOutputTokens) => {
    const requestPayload = {
      systemInstruction: {
        role: 'system',
        parts: [{ text: personaPrompt }]
      },
      contents: [
        ...history,
        {
          role: 'user',
          parts: [{ text: message }]
        }
      ],
      generationConfig: {
        ...baseGenerationConfig,
        maxOutputTokens
      }
    }

    const result = await model.generateContent(requestPayload)
    const { response } = result

    if (!response) {
      return { status: 'no_response' }
    }

    const blockReason = response.promptFeedback?.blockReason
    if (blockReason && blockReason !== 'BLOCK_NONE') {
      const blockMessage = response.promptFeedback?.blockReasonMessage
      return {
        status: 'blocked',
        text: blockMessage || '抱歉，我無法回覆這個問題，我們換個話題聊聊吧。'
      }
    }

    let responseText = ''

    try {
      responseText = response.text?.() ?? ''
    } catch (error) {
      console.warn('[AI Companion] response.text() 解析失敗：', error)
    }

    responseText = responseText.trim()

    if (responseText) {
      return { status: 'ok', text: responseText }
    }

    const candidates = response.candidates ?? []

    if (candidates.length) {
      console.warn(
        '[AI Companion] Gemini 回傳空白內容，嘗試從候選結果擷取。',
        JSON.stringify(candidates, null, 2)
      )
    }

    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? []
      const partTexts = parts
        .map(part => (typeof part.text === 'string' ? part.text.trim() : ''))
        .filter(Boolean)

      if (partTexts.length) {
        return {
          status: 'ok',
          text: partTexts.join('\n')
        }
      }

      if (candidate.finishReason === 'SAFETY') {
        return {
          status: 'blocked',
          text: '抱歉，我無法回覆這個問題，我們換個話題聊聊吧。'
        }
      }
    }

    const firstFinish = candidates[0]?.finishReason
    if (firstFinish === 'MAX_TOKENS') {
      return { status: 'retry_tokens' }
    }

    return { status: 'empty' }
  }

  let everHitTokenLimit = false

  for (let i = 0; i < maxTokenVariants.length; i += 1) {
    const maxOutputTokens = maxTokenVariants[i]
    let sawMaxTokenLimit = false

    for (const history of historyVariants) {
      const result = await tryGenerate(history, maxOutputTokens)
      if (result.status === 'ok') {
        return {
          persona,
          text: result.text
        }
      }
      if (result.status === 'blocked') {
        return {
          persona,
          text: result.text
        }
      }
      if (result.status === 'retry_tokens') {
        sawMaxTokenLimit = true
        everHitTokenLimit = true
      }
    }

    if (sawMaxTokenLimit && maxTokenVariants[i + 1]) {
      console.warn(`[AI Companion] Gemini 達到輸出字數上限 (maxOutputTokens=${maxOutputTokens})，嘗試放寬至 ${maxTokenVariants[i + 1]} 後重試。`)
      continue
    }
  }

  if (everHitTokenLimit) {
    console.warn('[AI Companion] Gemini 仍回傳 MAX_TOKENS，即使放寬限制仍無法取得內容。')
  }

  return {
    persona,
    text: '抱歉，我一時想不到合適的回應，請換個說法試試。'
  }
}
