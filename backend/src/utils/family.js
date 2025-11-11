import pool from '../db/pool.js'

export const fetchUserRelation = async (userId) => {
  if (!Number.isFinite(userId)) return null
  const { rows } = await pool.query(
    'SELECT user_id, owner_user_id, charactor FROM users WHERE user_id = $1 LIMIT 1',
    [userId]
  )
  return rows[0] ?? null
}

export const belongsToSameFamily = (requester, elder) => {
  if (!requester || !elder) return false
  if (requester.user_id === elder.user_id) return true
  if (Number.isFinite(requester.owner_user_id) && requester.owner_user_id === elder.user_id) return true
  if (Number.isFinite(elder.owner_user_id) && elder.owner_user_id === requester.user_id) return true
  if (
    Number.isFinite(requester.owner_user_id) &&
    Number.isFinite(elder.owner_user_id) &&
    requester.owner_user_id === elder.owner_user_id
  ) {
    return true
  }
  return false
}

export const resolveElderIdForUser = (user) => {
  if (!user) return null
  if (Number.isFinite(user.owner_user_id)) {
    return user.owner_user_id
  }
  return user.user_id
}
