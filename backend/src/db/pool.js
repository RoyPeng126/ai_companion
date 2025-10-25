import '../config/env.js'
import { Pool } from 'pg'

// Use a single shared pool. Neon requires TLS; relax CA verification for dev.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

export default pool

