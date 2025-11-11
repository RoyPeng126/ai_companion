#!/usr/bin/env node
import crypto from 'node:crypto'

const secret = (process.env.FACEBOOK_TOKEN_SECRET || '').trim()
if (!secret) {
  console.error('[encryptFacebookToken] FACEBOOK_TOKEN_SECRET 未設定，無法加密。')
  process.exit(1)
}

const rawToken = process.argv[2]
if (!rawToken) {
  console.error('使用方式：FACEBOOK_TOKEN_SECRET=xxx pnpm encrypt:fb-token -- "<facebook_user_access_token>"')
  process.exit(1)
}

const key = crypto.createHash('sha256').update(secret, 'utf8').digest()
const iv = crypto.randomBytes(12)
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()])
const authTag = cipher.getAuthTag()
const payload = [
  iv.toString('base64'),
  encrypted.toString('base64'),
  authTag.toString('base64')
].join(':')

console.log(payload)
