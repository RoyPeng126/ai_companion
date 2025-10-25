import { EventEmitter } from 'node:events'

class NotificationService extends EventEmitter {
  constructor () {
    super()
    this.notifications = []
  }

  push (payload) {
    const enriched = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      ...payload
    }
    this.notifications.push(enriched)
    this.emit('notification', enriched)
    return enriched
  }

  listByFamily (familyId) {
    return this.notifications.filter(item => item.familyId === familyId)
  }

  listByUser (userId) {
    return this.notifications.filter(item => item.userId === userId)
  }
}

export const notificationService = new NotificationService()
