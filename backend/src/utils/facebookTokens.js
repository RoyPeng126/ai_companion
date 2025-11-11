import crypto from 'node:crypto'

const TOKEN_SECRET = (process.env.FACEBOOK_TOKEN_SECRET || '').trim()
let derivedKey = null

const getKey = () => {
  if (!TOKEN_SECRET) return null
  if (!derivedKey) {
    derivedKey = crypto.createHash('sha256').update(TOKEN_SECRET, 'utf8').digest()
  }
  return derivedKey
}

export const hasTokenSecret = () => Boolean(getKey())

export const encryptFacebookToken = (rawToken) => {
  if (!rawToken) return ''
  const key = getKey()
  if (!key) {
    return rawToken
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    encrypted.toString('base64'),
    authTag.toString('base64')
  ].join(':')
}

export const decryptFacebookToken = (encoded) => {
  if (!encoded) return ''
  const key = getKey()
  if (!key) {
    return encoded
  }
  const parts = String(encoded).split(':')
  if (parts.length !== 3) return ''
  try {
    const [ivB64, cipherB64, tagB64] = parts
    const iv = Buffer.from(ivB64, 'base64')
    const ciphertext = Buffer.from(cipherB64, 'base64')
    const authTag = Buffer.from(tagB64, 'base64')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch (error) {
    console.warn('[facebookTokens] decrypt failed:', error.message)
    return ''
  }
}
