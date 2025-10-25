import rateLimit from 'express-rate-limit'

// Strict for password changes: at most 5 per 10 minutes per IP
export const changePasswordLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' }
})

// Moderate limit for profile updates: at most 20 per minute per IP
export const updateProfileLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' }
})

