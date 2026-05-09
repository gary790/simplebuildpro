// ============================================================
// SimpleBuild Pro — Data Residency Middleware
// Enforces data locality for EU/US regions
// Routes requests to appropriate regional infrastructure
// ============================================================

import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';

// ─── Types ───────────────────────────────────────────────────

export type DataRegion = 'us' | 'eu';

export interface RegionConfig {
  region: DataRegion;
  gcpRegion: string;
  cloudSqlInstance: string;
  gcsBucket: string;
  redisHost: string;
  description: string;
}

export interface DataResidencySettings {
  region: DataRegion;
  enforceStrict: boolean; // Block cross-region data access entirely
  allowedRegions: DataRegion[]; // Regions this org can access
  createdAt: string;
  updatedAt: string;
}

// ─── Region Configuration ────────────────────────────────────

export const REGION_CONFIGS: Record<DataRegion, RegionConfig> = {
  us: {
    region: 'us',
    gcpRegion: 'us-central1',
    cloudSqlInstance: 'simplebuildpro-db',
    gcsBucket: 'simplebuildpro-assets-us',
    redisHost: '10.1.204.211', // Current Redis instance
    description: 'United States (Iowa)',
  },
  eu: {
    region: 'eu',
    gcpRegion: 'europe-west1',
    cloudSqlInstance: 'simplebuildpro-db-eu',
    gcsBucket: 'simplebuildpro-assets-eu',
    redisHost: '10.2.0.3', // EU Redis (to be provisioned)
    description: 'European Union (Belgium)',
  },
};

// ─── Region Detection ────────────────────────────────────────

/**
 * Detect user's region from various signals
 * Priority: org setting > header > IP geolocation > default
 */
export function detectRegion(c: Context): DataRegion {
  // 1. Check org-level data residency setting (highest priority)
  const orgRegion = c.get('orgDataRegion') as DataRegion | undefined;
  if (orgRegion && isValidRegion(orgRegion)) {
    return orgRegion;
  }

  // 2. Check X-Data-Region header (client override for testing)
  const headerRegion = c.req.header('X-Data-Region')?.toLowerCase();
  if (headerRegion && isValidRegion(headerRegion as DataRegion)) {
    return headerRegion as DataRegion;
  }

  // 3. Check Cloud Load Balancer geo headers
  const country = c.req.header('X-Client-Geo-Location')?.split(',')[0]?.trim();
  if (country) {
    return getRegionFromCountry(country);
  }

  // 4. Check Cloudflare-style headers (if behind CF)
  const cfCountry = c.req.header('CF-IPCountry');
  if (cfCountry) {
    return getRegionFromCountry(cfCountry);
  }

  // 5. Default to US
  return 'us';
}

/**
 * Map ISO country codes to data regions
 * EU countries follow GDPR data residency requirements
 */
function getRegionFromCountry(countryCode: string): DataRegion {
  const euCountries = new Set([
    // EU Member States
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    // EEA (GDPR applies)
    'IS', 'LI', 'NO',
    // UK (post-Brexit, still follows similar data protection)
    'GB',
    // Switzerland (adequate protection)
    'CH',
  ]);

  return euCountries.has(countryCode.toUpperCase()) ? 'eu' : 'us';
}

function isValidRegion(region: string): boolean {
  return region === 'us' || region === 'eu';
}

// ─── Data Residency Middleware ───────────────────────────────

/**
 * Middleware that enforces data residency rules
 * Sets the appropriate region context for downstream handlers
 */
export const dataResidencyMiddleware = createMiddleware(async (c, next) => {
  const region = detectRegion(c);
  const config = REGION_CONFIGS[region];

  // Set region context for downstream handlers
  c.set('dataRegion', region);
  c.set('regionConfig', config);

  // Add region header to response for transparency
  c.header('X-Data-Region', region);
  c.header('X-Data-Location', config.description);

  await next();
});

/**
 * Strict residency enforcement — blocks requests that would
 * cause cross-region data transfer
 */
export const strictResidencyMiddleware = createMiddleware(async (c, next) => {
  const orgRegion = c.get('orgDataRegion') as DataRegion | undefined;
  const requestRegion = detectRegion(c);

  // If org has strict residency, ensure request routes to correct region
  if (orgRegion && orgRegion !== requestRegion) {
    const orgConfig = REGION_CONFIGS[orgRegion];
    
    // In production, this would redirect to the regional endpoint
    // For now, we enforce at the application level
    c.header('X-Data-Region-Redirect', orgConfig.gcpRegion);
    c.header('X-Data-Region-Warning', 'strict-residency-enforced');
    
    // Override to org's region (data never leaves designated region)
    c.set('dataRegion', orgRegion);
    c.set('regionConfig', orgConfig);
  }

  await next();
});

// ─── Regional Database Router ────────────────────────────────

/**
 * Returns the appropriate database connection string for the region
 * In multi-region setup, each region has its own Cloud SQL instance
 */
export function getRegionalDatabaseUrl(region: DataRegion): string {
  const config = REGION_CONFIGS[region];
  
  // In production, each region has its own DATABASE_URL secret
  const envKey = region === 'us' ? 'DATABASE_URL' : `DATABASE_URL_${region.toUpperCase()}`;
  const dbUrl = process.env[envKey] || process.env.DATABASE_URL;
  
  if (!dbUrl) {
    throw new Error(`No database URL configured for region: ${region} (env: ${envKey})`);
  }
  
  return dbUrl;
}

/**
 * Returns the appropriate GCS bucket for the region
 */
export function getRegionalBucket(region: DataRegion): string {
  const config = REGION_CONFIGS[region];
  
  const envKey = region === 'us' ? 'GCS_BUCKET' : `GCS_BUCKET_${region.toUpperCase()}`;
  return process.env[envKey] || config.gcsBucket;
}

/**
 * Returns the appropriate Redis host for the region
 */
export function getRegionalRedisUrl(region: DataRegion): string {
  const config = REGION_CONFIGS[region];
  
  const envKey = region === 'us' ? 'REDIS_URL' : `REDIS_URL_${region.toUpperCase()}`;
  return process.env[envKey] || `redis://${config.redisHost}:6379`;
}

// ─── Data Transfer Compliance ────────────────────────────────

/**
 * Validates whether a data transfer between regions is allowed
 * Based on org settings and applicable regulations
 */
export function isTransferAllowed(
  sourceRegion: DataRegion,
  targetRegion: DataRegion,
  orgSettings?: DataResidencySettings,
): { allowed: boolean; reason?: string } {
  // Same region is always allowed
  if (sourceRegion === targetRegion) {
    return { allowed: true };
  }

  // If org has strict enforcement, block cross-region transfers
  if (orgSettings?.enforceStrict) {
    return {
      allowed: false,
      reason: `Strict data residency enforcement: data must remain in ${orgSettings.region} region`,
    };
  }

  // EU → US requires adequacy decision or SCCs
  if (sourceRegion === 'eu' && targetRegion === 'us') {
    // Under EU-US Data Privacy Framework (2023), transfers are allowed
    // with appropriate safeguards
    return {
      allowed: true,
      reason: 'Transfer allowed under EU-US Data Privacy Framework with Standard Contractual Clauses',
    };
  }

  return { allowed: true };
}

// ─── Org Data Residency Configuration ────────────────────────

/**
 * SQL queries for managing org data residency settings
 */
export const dataResidencyQueries = {
  getOrgResidency: `
    SELECT data_region, enforce_strict_residency, allowed_regions
    FROM organizations 
    WHERE id = $1
  `,
  
  setOrgResidency: `
    UPDATE organizations 
    SET data_region = $1, 
        enforce_strict_residency = $2, 
        allowed_regions = $3,
        updated_at = NOW()
    WHERE id = $4
  `,
  
  getOrgsByRegion: `
    SELECT id, name, slug, data_region 
    FROM organizations 
    WHERE data_region = $1
  `,
};
