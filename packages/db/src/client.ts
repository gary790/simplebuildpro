// ============================================================
// SimpleBuild Pro — Database Client
// Cloud SQL PostgreSQL connection via Drizzle ORM
// ============================================================

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// Connection pool — configured for Cloud Run → Cloud SQL
// In production, uses Unix socket via Cloud SQL Auth Proxy
// In development, uses TCP with connection string
function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL environment variable is required. ' +
      'Format: postgresql://user:password@host:5432/simplebuildpro'
    );
  }

  return new Pool({
    connectionString,
    max: 20,                    // Max connections in pool
    idleTimeoutMillis: 30000,   // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // Timeout connecting after 10s
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false } // Cloud SQL uses self-signed certs
      : false,
  });
}

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

export function getDb() {
  if (!db) {
    db = drizzle(getPool(), { schema });
  }
  return db;
}

// Graceful shutdown
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

// Health check — verifies database connectivity
export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const p = getPool();
    const client = await p.connect();
    await client.query('SELECT 1');
    client.release();
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown database error',
    };
  }
}

// Type export for consumers
export type Database = ReturnType<typeof getDb>;
