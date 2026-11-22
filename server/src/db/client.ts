import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL tanımlı değil')

// Migration client — single connection, no pool (for migration script use)
export const migrationClient = postgres(connectionString, { max: 1 })

// Application pool
const pool = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 1800,
  onnotice: () => {},
})

export const db = drizzle(pool, { schema })

/**
 * Cross-process PostgreSQL session advisory lock on a reserved pool connection.
 * Safe across multi-replica deployments and automatically released if the connection drops.
 */
export async function withPgAdvisoryLock<T>(
  namespace: string,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const reserved = await pool.reserve()
  try {
    await reserved`SELECT pg_advisory_lock(hashtext(${namespace}), hashtext(${key}))`
    try {
      return await fn()
    } finally {
      await reserved`SELECT pg_advisory_unlock(hashtext(${namespace}), hashtext(${key}))`.catch(() => {})
    }
  } finally {
    reserved.release()
  }
}

export async function checkDbHealth(): Promise<boolean> {
  try {
    await pool`SELECT 1`
    return true
  } catch {
    return false
  }
}

export async function closeDb(): Promise<void> {
  await pool.end({ timeout: 5 })
}
