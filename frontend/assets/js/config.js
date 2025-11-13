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
    const protocol = window.location?.protocol || 'http:'
    const hostname = window.location?.hostname || 'localhost'
    // Backend listens on 3001 by default; keep same host to stay same-site on LAN.
    return `${protocol}//${hostname || 'localhost'}:3001`
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
