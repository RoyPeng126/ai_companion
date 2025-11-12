const strip = (value = '') => String(value || '').trim()

export const normalizeEmail = (email = '') => {
  const trimmed = strip(email).toLowerCase()
  if (!trimmed) return ''
  return trimmed
}

export const normalizePhone = (phone = '') => {
  const digits = strip(phone).replace(/\D+/g, '')
  // Basic safeguard: Taiwan mobile numbers are 9~10 digits (excluding country code)
  if (digits.length < 8) return ''
  return digits
}

export const normalizeRole = (role = '') => {
  const r = strip(role).toLowerCase()
  if (['grandpa', 'grandma', 'senior', 'elder'].includes(r)) return 'elder'
  if (r === 'family') return 'family'
  if (r === 'social-worker' || r === 'caregiver') return 'caregiver'
  return r
}

export const normalizeOwnerIds = (value) => {
  if (value === undefined || value === null) return []
  const rawList = Array.isArray(value) ? value : [value]
  const seen = new Set()
  for (const entry of rawList) {
    const num = Number(entry)
    if (Number.isFinite(num)) {
      if (!seen.has(num)) seen.add(num)
      if (seen.size >= 3) break
    }
  }
  return Array.from(seen.values())
}
