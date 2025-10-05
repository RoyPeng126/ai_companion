import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DATA_PATH = join(__dirname, '../../data/healthMetrics.json')

const readMetrics = async () => {
  try {
    const raw = await readFile(DATA_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

const writeMetrics = async (metrics) => {
  await writeFile(DATA_PATH, JSON.stringify(metrics, null, 2), 'utf-8')
}

export const listMetrics = async () => {
  return await readMetrics()
}

export const upsertMetric = async (metric) => {
  const metrics = await readMetrics()
  const index = metrics.findIndex(item => item.userId === metric.userId)
  const payload = {
    ...metrics[index] ?? {},
    ...metric,
    lastSync: metric.lastSync ?? new Date().toISOString()
  }

  if (index >= 0) {
    metrics[index] = payload
  } else {
    metrics.push(payload)
  }

  await writeMetrics(metrics)
  return payload
}

export const getMetric = async (userId) => {
  const metrics = await readMetrics()
  return metrics.find(item => item.userId === userId) ?? null
}
