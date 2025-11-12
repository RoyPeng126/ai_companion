import pool from '../db/pool.js'

const toOwnerArray = (user) => {
  if (!user) return []
  if (Array.isArray(user.owner_user_ids)) {
    return user.owner_user_ids.map(Number).filter((id) => Number.isFinite(id))
  }
  if (Number.isFinite(user.owner_user_id)) {
    return [Number(user.owner_user_id)]
  }
  return []
}

export const fetchUserRelation = async (userId) => {
  if (!Number.isFinite(userId)) return null
  const { rows } = await pool.query(
    'SELECT user_id, owner_user_ids, charactor FROM users WHERE user_id = $1 LIMIT 1',
    [userId]
  )
  return rows[0] ?? null
}

export const belongsToSameFamily = (requester, elder) => {
  if (!requester || !elder) return false
  if (requester.user_id === elder.user_id) return true
  const requesterOwners = toOwnerArray(requester)
  const elderOwners = toOwnerArray(elder)
  if (requesterOwners.includes(elder.user_id)) return true
  if (elderOwners.includes(requester.user_id)) return true
  if (requesterOwners.some((id) => elderOwners.includes(id))) return true
  return false
}

export const resolveElderIdForUser = (user) => {
  if (!user) return null
  const owners = toOwnerArray(user)
  if (owners.length > 0) return owners[0]
  return user.user_id
}
