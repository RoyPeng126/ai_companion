import express from 'express'
import pool from '../db/pool.js'
import { withCookies, requireAuth } from '../middleware/auth.js'

const router = express.Router()
router.use(withCookies)

const parseDate = (value) => {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

const toISODate = (d) => d.toISOString().slice(0, 10)

const getMonthStart = (value) => {
  if (!value) {
    const now = new Date()
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  }
  const [y, m] = value.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m)) {
    throw new Error('invalid_month')
  }
  return new Date(Date.UTC(y, m - 1, 1))
}

router.post('/rebuild/daily', async (req, res, next) => {
  try {
    const fromDate = parseDate(req.query.from) || parseDate(req.body?.from) || null
    const toDate = parseDate(req.query.to) || parseDate(req.body?.to) || null

    let from = fromDate
    let to = toDate
    if (!from || !to) {
      const now = new Date()
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      from = today
      to = new Date(today.getTime() + 24 * 60 * 60 * 1000)
    }

    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    const sql = `
      SELECT
        e.user_id,
        (e.start_time AT TIME ZONE 'Asia/Taipei')::date AS score_date,
        SUM(CASE WHEN e.owner_user_id <> e.user_id THEN 1 ELSE 0 END) AS care_total,
        SUM(CASE WHEN e.owner_user_id <> e.user_id AND e.status THEN 1 ELSE 0 END) AS care_done,
        SUM(CASE WHEN e.owner_user_id = e.user_id THEN 1 ELSE 0 END) AS self_total,
        SUM(CASE WHEN e.owner_user_id = e.user_id AND e.status THEN 1 ELSE 0 END) AS self_done
      FROM user_events e
      WHERE e.start_time >= $1::timestamptz
        AND e.start_time <  $2::timestamptz
      GROUP BY e.user_id, score_date
    `

    const { rows } = await pool.query(sql, [fromIso, toIso])

    const upsertSql = `
      INSERT INTO score_periods (
        user_id, period_type, period_start,
        care_tasks_score, self_tasks_score, bonus_points, total_score,
        created_at, updated_at
      ) VALUES (
        $1,'day',$2,
        $3,$4,$5,$6,
        now(),now()
      )
      ON CONFLICT (user_id, period_type, period_start)
      DO UPDATE SET
        care_tasks_score = EXCLUDED.care_tasks_score,
        self_tasks_score = EXCLUDED.self_tasks_score,
        bonus_points     = EXCLUDED.bonus_points,
        total_score      = EXCLUDED.total_score,
        updated_at       = now()
    `

    const results = []
    for (const row of rows) {
      const careTotal = Number(row.care_total) || 0
      const careDone = Number(row.care_done) || 0
      const selfTotal = Number(row.self_total) || 0
      const selfDone = Number(row.self_done) || 0

      const careScore =
        careTotal > 0 ? Math.round((careDone / careTotal) * 10) : 0
      const selfScore =
        selfTotal > 0 ? Math.round((selfDone / selfTotal) * 8) : 0

      const bonus = 0
      const total = careScore + selfScore + bonus

      await pool.query(upsertSql, [
        row.user_id,
        row.score_date,
        careScore,
        selfScore,
        bonus,
        total
      ])

      results.push({
        user_id: row.user_id,
        score_date: toISODate(new Date(row.score_date)),
        care_tasks_score: careScore,
        self_tasks_score: selfScore,
        bonus_points: bonus,
        total_score: total
      })
    }

    res.json({ updated: results.length, from: fromIso, to: toIso, rows: results })
  } catch (error) {
    next(error)
  }
})

router.post('/rebuild/monthly', async (req, res, next) => {
  try {
    const monthParam = req.query.month || req.body?.month || null
    const monthStart = getMonthStart(monthParam)
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))

    const sql = `
      SELECT
        user_id,
        SUM(care_tasks_score)::int   AS care_tasks_score,
        SUM(self_tasks_score)::int   AS self_tasks_score,
        SUM(bonus_points)::int       AS bonus_points,
        SUM(total_score)::int        AS total_score
      FROM score_periods
      WHERE period_type = 'day'
        AND period_start >= $1::date
        AND period_start <  $2::date
      GROUP BY user_id
    `

    const { rows } = await pool.query(sql, [
      toISODate(monthStart),
      toISODate(monthEnd)
    ])

    const upsertSql = `
      INSERT INTO score_periods (
        user_id, period_type, period_start,
        care_tasks_score, self_tasks_score, bonus_points, total_score,
        created_at, updated_at
      ) VALUES (
        $1,'month',$2,
        $3,$4,$5,$6,
        now(),now()
      )
      ON CONFLICT (user_id, period_type, period_start)
      DO UPDATE SET
        care_tasks_score = EXCLUDED.care_tasks_score,
        self_tasks_score = EXCLUDED.self_tasks_score,
        bonus_points     = EXCLUDED.bonus_points,
        total_score      = EXCLUDED.total_score,
        updated_at       = now()
    `

    for (const row of rows) {
      await pool.query(upsertSql, [
        row.user_id,
        toISODate(monthStart),
        row.care_tasks_score || 0,
        row.self_tasks_score || 0,
        row.bonus_points || 0,
        row.total_score || 0
      ])
    }

    // --- 成就計算與加分 ---
    const monthStartIso = toISODate(monthStart)
    const monthEndIso = toISODate(monthEnd)

    const catSql = `
      SELECT
        user_id,
        COALESCE(category, '') AS category,
        COUNT(*)::int AS total,
        SUM(CASE WHEN status THEN 1 ELSE 0 END)::int AS done
      FROM user_events
      WHERE start_time >= $1::timestamptz
        AND start_time <  $2::timestamptz
      GROUP BY user_id, category
    `

    const { rows: catRows } = await pool.query(catSql, [monthStartIso, monthEndIso])

    const daySql = `
      SELECT user_id, COUNT(*)::int AS days_with_score
      FROM score_periods
      WHERE period_type = 'day'
        AND period_start >= $1::date
        AND period_start <  $2::date
        AND total_score > 0
      GROUP BY user_id
    `

    const { rows: dayRows } = await pool.query(daySql, [monthStartIso, monthEndIso])

    const perUser = new Map()

    for (const row of catRows) {
      const uid = row.user_id
      if (!perUser.has(uid)) perUser.set(uid, { categories: {}, daysWithScore: 0 })
      const info = perUser.get(uid)
      info.categories[row.category] = {
        total: row.total,
        done: row.done
      }
    }

    for (const row of dayRows) {
      const uid = row.user_id
      if (!perUser.has(uid)) perUser.set(uid, { categories: {}, daysWithScore: 0 })
      perUser.get(uid).daysWithScore = row.days_with_score
    }

    const ACH_KEYS = [
      'medicine_perfect_month',
      'exercise_6_in_month',
      'appointment_keeper',
      'chatty_friend',
      'routine_master'
    ]

    await pool.query(
      'DELETE FROM user_achievements WHERE period_start = $1 AND key = ANY($2::text[])',
      [monthStartIso, ACH_KEYS]
    )

    const bonuses = new Map()

    for (const [userId, info] of perUser.entries()) {
      const cat = info.categories || {}
      const daysWithScore = info.daysWithScore || 0

      const medicine = cat.medicine || { total: 0, done: 0 }
      const exercise = cat.exercise || { total: 0, done: 0 }
      const appointment = cat.appointment || { total: 0, done: 0 }
      const chat = cat.chat || { total: 0, done: 0 }

      const userAchievements = []

      // 百毒不侵：本月用藥完成率高且次數足夠，目標至少 7 次
      const medRate = medicine.total > 0 ? medicine.done / medicine.total : 0
      const medTarget = Math.max(medicine.total || 0, 7)
      userAchievements.push({
        key: 'medicine_perfect_month',
        bonus: medicine.total >= 7 && medRate >= 0.95 ? 10 : 0,
        meta: {
          done: medicine.done,
          total: medicine.total,
          target: medTarget
        }
      })

      // 強身健體：本月運動完成次數至少 6 次
      const exTarget = 6
      userAchievements.push({
        key: 'exercise_6_in_month',
        bonus: exercise.done >= exTarget ? 10 : 0,
        meta: {
          done: exercise.done,
          target: exTarget
        }
      })

      // 門診不缺席：本月所有就醫任務都完成（若 total=0 則只顯示 0/0，不加分）
      const appTarget = appointment.total || 0
      userAchievements.push({
        key: 'appointment_keeper',
        bonus: appointment.total > 0 && appointment.done === appointment.total ? 8 : 0,
        meta: {
          done: appointment.done,
          total: appointment.total,
          target: appTarget
        }
      })

      // 愛聊聊天：本月聊天任務完成次數至少 20 次
      const chatTarget = 20
      userAchievements.push({
        key: 'chatty_friend',
        bonus: chat.done >= chatTarget ? 5 : 0,
        meta: {
          done: chat.done,
          target: chatTarget
        }
      })

      // 天天不間斷：本月至少 20 天有任務完成
      const routineTarget = 20
      userAchievements.push({
        key: 'routine_master',
        bonus: daysWithScore >= routineTarget ? 10 : 0,
        meta: {
          days_with_score: daysWithScore,
          target: routineTarget
        }
      })

      let totalBonus = 0
      for (const ach of userAchievements) {
        totalBonus += ach.bonus
        await pool.query(
          `INSERT INTO user_achievements (user_id, key, period_start, bonus_points, meta)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (user_id, key, period_start)
           DO UPDATE SET bonus_points = EXCLUDED.bonus_points, meta = EXCLUDED.meta`,
          [userId, ach.key, monthStartIso, ach.bonus, ach.meta]
        )
      }

      if (totalBonus > 0) {
        bonuses.set(userId, totalBonus)
      }
    }

    for (const [userId, bonus] of bonuses.entries()) {
      await pool.query(
        `UPDATE score_periods
         SET bonus_points = $1,
             total_score  = care_tasks_score + self_tasks_score + $1,
             updated_at   = now()
         WHERE user_id = $2 AND period_type = 'month' AND period_start = $3`,
        [bonus, userId, monthStartIso]
      )
    }

    res.json({
      month: monthStartIso,
      updated: rows.length,
      achievements_updated: bonuses.size
    })
  } catch (error) {
    if (error.message === 'invalid_month') {
      return res.status(400).json({ error: 'invalid_month' })
    }
    next(error)
  }
})

router.get('/monthly', requireAuth, async (req, res, next) => {
  try {
    const monthParam = req.query.month || null
    const monthStart = getMonthStart(monthParam)
    const scope = (req.query.scope || 'global').toString()

    const sql = `
      SELECT
        s.user_id,
        s.care_tasks_score,
        s.self_tasks_score,
        s.bonus_points,
        s.total_score,
        u.full_name,
        u.username
      FROM score_periods s
      JOIN users u ON u.user_id = s.user_id
      WHERE s.period_type = 'month'
        AND s.period_start = $1::date
      ORDER BY s.total_score DESC, s.user_id ASC
      LIMIT 100
    `

    const { rows } = await pool.query(sql, [toISODate(monthStart)])

    const { rows: achRows } = await pool.query(
      `SELECT user_id, key, bonus_points, meta
       FROM user_achievements
       WHERE period_start = $1`,
      [toISODate(monthStart)]
    )

    let friendIds = null
    if (scope === 'friends') {
      const { rows: friendRows } = await pool.query(
        `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
         FROM elder_friendships
         WHERE (requester_id = $1 OR addressee_id = $1)
           AND status = 'accepted'`,
        [req.userId]
      )
      friendIds = new Set([req.userId])
      for (const row of friendRows) {
        friendIds.add(row.friend_id)
      }
    }

    const achByUser = new Map()
    for (const row of achRows) {
      if (!achByUser.has(row.user_id)) achByUser.set(row.user_id, [])
      achByUser.get(row.user_id).push({
        key: row.key,
        bonus_points: row.bonus_points,
        meta: row.meta || null
      })
    }

    const filteredRows = friendIds
      ? rows.filter((row) => friendIds.has(row.user_id))
      : rows

    const entries = filteredRows.map((row, index) => ({
      user_id: row.user_id,
      name: row.full_name || row.username || `使用者 #${row.user_id}`,
      care_tasks_score: row.care_tasks_score,
      self_tasks_score: row.self_tasks_score,
      bonus_points: row.bonus_points,
      total_score: row.total_score,
      rank: index + 1,
      achievements: achByUser.get(row.user_id) || []
    }))

    res.json({
      month: toISODate(monthStart),
      scope,
      entries
    })
  } catch (error) {
    next(error)
  }
})

export default router
