# SimpleBuild Pro — Database Sharding Strategy

**Version**: 1.0  
**Target**: Organization-based horizontal sharding  
**Timeline**: Phase 2 of GKE migration (when single DB reaches limits)

---

## 1. Sharding Strategy Overview

### Shard Key: `organization_id`

All multi-tenant data is naturally partitioned by organization. This makes `organization_id` the ideal shard key:

- **Natural isolation**: Orgs never access each other's data
- **Even distribution**: Orgs vary in size but new ones are assigned to least-loaded shard
- **No cross-shard queries**: 95%+ of queries are org-scoped
- **Regulatory compliance**: Enables data residency per org

### Sharding Topology

```
                    ┌──────────────────┐
                    │   Shard Router    │
                    │  (API middleware) │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
      ┌───────▼───────┐ ┌───▼───────┐ ┌───▼───────────┐
      │  Shard 0 (US) │ │ Shard 1   │ │ Shard 2 (EU)  │
      │ Cloud SQL     │ │ Cloud SQL │ │ Cloud SQL     │
      │ orgs 1-1000   │ │ orgs 1001+│ │ EU residency  │
      └───────────────┘ └───────────┘ └───────────────┘

      ┌─────────────────────────────────────────────────┐
      │              Global Shard (unsharded)            │
      │  users, auth, billing, shard_directory          │
      └─────────────────────────────────────────────────┘
```

---

## 2. When to Shard

| Metric | Current | Threshold | Action |
|--------|---------|-----------|--------|
| DB size | ~2GB | 100GB | Add shard |
| Connections | ~50 | 500 | Add read replicas first |
| Query latency (p99) | 41ms | 200ms | Investigate, then shard |
| Write IOPS | ~100 | 10,000 | Shard writes |
| Organizations | ~50 | 5,000 | Consider sharding |
| Concurrent users | ~200 | 50,000 | Shard + read replicas |

**Pre-sharding optimizations (do these first):**
1. ✅ Connection pooling (max=10, min=2)
2. ✅ Redis caching layer
3. Read replicas (Cloud SQL)
4. Query optimization + missing indexes
5. Table partitioning (PostgreSQL native)

---

## 3. Shard Directory Schema

```sql
-- Global database: shard_directory
-- This table lives in the global (unsharded) database
-- and maps organizations to their data shard

CREATE TABLE shard_directory (
  id SERIAL PRIMARY KEY,
  organization_id UUID NOT NULL UNIQUE,
  shard_id INTEGER NOT NULL,
  shard_name VARCHAR(50) NOT NULL,
  region VARCHAR(20) NOT NULL DEFAULT 'us-central1',
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, migrating, read_only
  created_at TIMESTAMP DEFAULT NOW(),
  migrated_at TIMESTAMP,
  
  CONSTRAINT valid_status CHECK (status IN ('active', 'migrating', 'read_only', 'archived'))
);

CREATE INDEX idx_shard_directory_shard_id ON shard_directory(shard_id);
CREATE INDEX idx_shard_directory_region ON shard_directory(region);

-- Shard configuration
CREATE TABLE shard_configs (
  id SERIAL PRIMARY KEY,
  shard_id INTEGER NOT NULL UNIQUE,
  shard_name VARCHAR(50) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 5432,
  database_name VARCHAR(100) NOT NULL,
  region VARCHAR(20) NOT NULL,
  max_organizations INTEGER NOT NULL DEFAULT 1000,
  current_organizations INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  capacity_percent FLOAT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT valid_shard_status CHECK (status IN ('active', 'full', 'read_only', 'maintenance'))
);

-- Track shard health
CREATE TABLE shard_health (
  id SERIAL PRIMARY KEY,
  shard_id INTEGER NOT NULL REFERENCES shard_configs(shard_id),
  checked_at TIMESTAMP DEFAULT NOW(),
  latency_ms INTEGER,
  connections_active INTEGER,
  connections_max INTEGER,
  disk_usage_gb FLOAT,
  disk_total_gb FLOAT,
  replication_lag_ms INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'healthy'
);
```

---

## 4. Shard Router Implementation

```typescript
// apps/api/src/services/shard-router.ts
// Routes database queries to the correct shard based on organization_id

import { Pool } from 'pg';
import { cache } from './cache';
import { logger } from './logger';

interface ShardConfig {
  shardId: number;
  shardName: string;
  host: string;
  port: number;
  database: string;
  region: string;
  status: string;
}

interface ShardMapping {
  organizationId: string;
  shardId: number;
  region: string;
}

// Connection pools per shard
const shardPools: Map<number, Pool> = new Map();

// Global database pool (users, auth, billing, shard_directory)
let globalPool: Pool;

/**
 * Initialize shard connections
 */
export async function initializeShardRouter(): Promise<void> {
  // Global pool — always connects to the primary database
  globalPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Load shard configs and create pools
  const shardConfigs = await loadShardConfigs();
  
  for (const config of shardConfigs) {
    if (config.status === 'active' || config.status === 'full') {
      const pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        ssl: { rejectUnauthorized: false },
        max: 10,
        min: 2,
        idleTimeoutMillis: 30000,
      });
      shardPools.set(config.shardId, pool);
      logger.info(`Shard ${config.shardId} (${config.shardName}) connected`, {
        region: config.region,
        host: config.host,
      });
    }
  }
}

/**
 * Get the database pool for a specific organization
 */
export async function getShardForOrg(organizationId: string): Promise<Pool> {
  // Check cache first
  const cacheKey = `shard:org:${organizationId}`;
  const cached = await cache.get<number>(cacheKey);
  
  if (cached !== null) {
    const pool = shardPools.get(cached);
    if (pool) return pool;
  }

  // Look up in shard directory
  const result = await globalPool.query(
    'SELECT shard_id FROM shard_directory WHERE organization_id = $1',
    [organizationId]
  );

  if (!result.rows.length) {
    // New org — assign to least-loaded shard
    const shardId = await assignOrgToShard(organizationId);
    await cache.set(cacheKey, shardId, 3600); // Cache for 1 hour
    return shardPools.get(shardId)!;
  }

  const shardId = result.rows[0].shard_id;
  await cache.set(cacheKey, shardId, 3600);
  
  const pool = shardPools.get(shardId);
  if (!pool) {
    throw new Error(`Shard ${shardId} not available for org ${organizationId}`);
  }
  
  return pool;
}

/**
 * Get the global database pool (for user auth, billing, etc.)
 */
export function getGlobalPool(): Pool {
  return globalPool;
}

/**
 * Assign a new organization to the least-loaded shard
 */
async function assignOrgToShard(organizationId: string): Promise<number> {
  // Find shard with lowest load that isn't full
  const result = await globalPool.query(`
    SELECT shard_id, region 
    FROM shard_configs 
    WHERE status = 'active' 
    ORDER BY current_organizations ASC 
    LIMIT 1
  `);

  if (!result.rows.length) {
    throw new Error('No available shards — all are full or in maintenance');
  }

  const shardId = result.rows[0].shard_id;
  const region = result.rows[0].region;

  // Insert mapping
  await globalPool.query(`
    INSERT INTO shard_directory (organization_id, shard_id, shard_name, region)
    VALUES ($1, $2, (SELECT shard_name FROM shard_configs WHERE shard_id = $2), $3)
  `, [organizationId, shardId, region]);

  // Update org count
  await globalPool.query(`
    UPDATE shard_configs 
    SET current_organizations = current_organizations + 1,
        capacity_percent = (current_organizations + 1)::float / max_organizations * 100
    WHERE shard_id = $1
  `, [shardId]);

  logger.info(`Organization ${organizationId} assigned to shard ${shardId}`, { region });
  
  return shardId;
}

/**
 * Load shard configurations from global database
 */
async function loadShardConfigs(): Promise<ShardConfig[]> {
  // In single-shard mode (current), return the primary DB as shard 0
  if (!process.env.SHARDING_ENABLED || process.env.SHARDING_ENABLED !== 'true') {
    return [{
      shardId: 0,
      shardName: 'primary',
      host: 'localhost', // Resolved via DATABASE_URL
      port: 5432,
      database: 'simplebuildpro',
      region: 'us-central1',
      status: 'active',
    }];
  }

  const result = await globalPool.query(
    'SELECT shard_id, shard_name, host, port, database_name, region, status FROM shard_configs WHERE status != $1',
    ['archived']
  );

  return result.rows.map(row => ({
    shardId: row.shard_id,
    shardName: row.shard_name,
    host: row.host,
    port: row.port,
    database: row.database_name,
    region: row.region,
    status: row.status,
  }));
}

/**
 * Migrate an organization from one shard to another
 * Used for data residency changes or load balancing
 */
export async function migrateOrgToShard(
  organizationId: string,
  targetShardId: number,
): Promise<{ success: boolean; message: string }> {
  const currentMapping = await globalPool.query(
    'SELECT shard_id FROM shard_directory WHERE organization_id = $1',
    [organizationId]
  );

  if (!currentMapping.rows.length) {
    return { success: false, message: 'Organization not found in shard directory' };
  }

  const sourceShardId = currentMapping.rows[0].shard_id;
  if (sourceShardId === targetShardId) {
    return { success: false, message: 'Organization already on target shard' };
  }

  // Mark as migrating
  await globalPool.query(
    'UPDATE shard_directory SET status = $1 WHERE organization_id = $2',
    ['migrating', organizationId]
  );

  // TODO: Implement actual data migration logic
  // 1. Set source to read_only for this org
  // 2. Copy all org data to target shard
  // 3. Verify data integrity (row counts, checksums)
  // 4. Update shard_directory to point to new shard
  // 5. Clear cache
  // 6. Set source org data for deletion (after retention period)

  logger.info(`Migration initiated: org ${organizationId} from shard ${sourceShardId} to ${targetShardId}`);

  return { 
    success: true, 
    message: `Migration queued: shard ${sourceShardId} → ${targetShardId}` 
  };
}

/**
 * Health check all shards
 */
export async function checkShardHealth(): Promise<Record<number, { healthy: boolean; latencyMs: number }>> {
  const results: Record<number, { healthy: boolean; latencyMs: number }> = {};

  for (const [shardId, pool] of shardPools.entries()) {
    const start = Date.now();
    try {
      await pool.query('SELECT 1');
      results[shardId] = { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      results[shardId] = { healthy: false, latencyMs: Date.now() - start };
      logger.error(`Shard ${shardId} health check failed`, { error: err });
    }
  }

  return results;
}
```

---

## 5. Tables by Shard Type

### Global (Unsharded) — `simplebuildpro-db`
These tables need cross-org access:

| Table | Reason |
|-------|--------|
| users | Auth lookup by email/id (not org-scoped) |
| oauth_accounts | OAuth provider mapping |
| refresh_tokens | Session management |
| organizations | Org metadata + shard routing |
| organization_members | Membership lookups |
| shard_directory | Routing table |
| shard_configs | Shard metadata |
| billing_* | Stripe integration (cross-org) |
| audit_logs | Global audit (replicated) |

### Sharded (Per-Org) — `simplebuildpro-shard-N`
These tables are fully org-scoped:

| Table | Shard Key |
|-------|-----------|
| projects | organization_id (via owner) |
| project_files | project → organization |
| project_assets | project → organization |
| deployments | project → organization |
| ai_conversations | project → organization |
| ai_messages | conversation → project → organization |
| usage_logs | organization_id |
| org_sso_configs | organization_id |
| org_branding | organization_id |
| dedicated_environments | organization_id |

---

## 6. Migration Plan (Single DB → Sharded)

### Phase A: Preparation (No downtime)
1. Create shard_directory table in current DB
2. Populate directory (all orgs → shard 0 / primary)
3. Deploy shard router code (disabled, routes to single DB)
4. Enable router in shadow mode (log which shard would be used)

### Phase B: First Shard (Minimal downtime: 10min)
1. Create Shard 1 Cloud SQL instance
2. Enable maintenance mode for target orgs
3. Copy target org data to Shard 1 (pg_dump filtered)
4. Update shard_directory
5. Enable routing
6. Verify data integrity
7. Disable maintenance mode

### Phase C: Regional Shards (For data residency)
1. Create EU shard (europe-west1)
2. Migrate EU-resident orgs (using migration function)
3. Update data_residency middleware to enforce routing

---

## 7. Cross-Shard Queries (Edge Cases)

Some operations need data from multiple shards:

| Operation | Strategy |
|-----------|----------|
| Admin dashboard (all orgs) | Query global + aggregate from each shard |
| User's projects (multi-org) | Query shard_directory → fan-out to each shard |
| Global search | Elasticsearch/Algolia (cross-shard index) |
| Analytics rollup | Async job: collect from shards → write to analytics DB |
| Billing reconciliation | Global DB has billing tables |

**Fan-out query pattern:**
```typescript
async function getUserProjectsAcrossOrgs(userId: string): Promise<Project[]> {
  // 1. Get all orgs for user (from global DB)
  const orgs = await getGlobalPool().query(
    'SELECT organization_id FROM organization_members WHERE user_id = $1',
    [userId]
  );
  
  // 2. Group by shard
  const shardGroups = new Map<number, string[]>();
  for (const org of orgs.rows) {
    const shardId = await getShardIdForOrg(org.organization_id);
    const group = shardGroups.get(shardId) || [];
    group.push(org.organization_id);
    shardGroups.set(shardId, group);
  }
  
  // 3. Parallel query each shard
  const results = await Promise.all(
    Array.from(shardGroups.entries()).map(async ([shardId, orgIds]) => {
      const pool = shardPools.get(shardId)!;
      return pool.query(
        'SELECT * FROM projects WHERE organization_id = ANY($1)',
        [orgIds]
      );
    })
  );
  
  // 4. Merge results
  return results.flatMap(r => r.rows);
}
```
