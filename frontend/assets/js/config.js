(function initConfig () {
  const API_BASE_STORAGE_KEY = 'AI_COMPANION_API_BASE'
  const AUTH_TOKEN_STORAGE_KEY = 'AI_COMPANION_AUTH_TOKEN'

  const readStoredBase = () => {
    try {
      return localStorage.getItem(API_BASE_STORAGE_KEY) || ''
    } catch (_) {
      return ''
    }
  }

  const deriveBaseFromLocation = () => {
    try {
      if (window.location?.origin) return window.location.origin
    } catch (_) {}
    const protocol = window.location?.protocol || 'http:'
    const hostname = window.location?.hostname || 'localhost'
    const port = window.location?.port || '3001'
    const portPart = port ? `:${port}` : ''
    return `${protocol}//${hostname || 'localhost'}${portPart}`
  }

  const sanitize = (value) => {
    if (!value) return ''
    return String(value).trim().replace(/\/$/, '')
  }

  const readAuthToken = () => {
    try {
      return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || ''
    } catch (_) {
      return ''
    }
  }

  const persistAuthToken = (token) => {
    const normalized = typeof token === 'string' ? token.trim() : ''
    try {
      if (normalized) {
        localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, normalized)
      } else {
        localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
      }
    } catch (_) {}
    return normalized
  }

  const clearAuthToken = () => {
    try {
      localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY)
    } catch (_) {}
  }

  const api = window.aiCompanion || {}
  api.getApiBase = () => sanitize(readStoredBase() || deriveBaseFromLocation())
  api.getAuthToken = () => readAuthToken()
  api.setAuthToken = (token) => persistAuthToken(token)
  api.clearAuthToken = () => clearAuthToken()
  window.aiCompanion = api
})()
