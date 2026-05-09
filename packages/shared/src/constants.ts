// ============================================================
// SimpleBuild Pro — Constants
// Domain: simplebuildpro.com
// ============================================================

export const APP_NAME = 'SimpleBuild Pro';
export const APP_DOMAIN = 'simplebuildpro.com';
export const APP_URL = 'https://simplebuildpro.com';
export const API_URL = 'https://api.simplebuildpro.com';
export const CDN_URL = 'https://cdn.simplebuildpro.com';
export const SITES_DOMAIN = 'sites.simplebuildpro.com'; // user sites: {slug}.sites.simplebuildpro.com

// ─── Google Cloud ────────────────────────────────────────────
export const GCP_PROJECT_ID = 'simplebuildpro';
export const GCP_REGION = 'us-central1';
export const GCS_BUCKET_ASSETS = 'simplebuildpro-assets';
export const GCS_BUCKET_BUILDS = 'simplebuildpro-builds';
export const GCS_BUCKET_DEPLOYS = 'simplebuildpro-deploys';
export const GCS_BUCKET_SNAPSHOTS = 'simplebuildpro-snapshots';

// ─── Plan Limits ─────────────────────────────────────────────
export const PLAN_LIMITS = {
  free: {
    projects: 3,
    aiMessagesPerMonth: 50,
    customDomains: 0,
    storageBytes: 100 * 1024 * 1024, // 100 MB
    deploysPerMonth: 10,
    maxFileSize: 5 * 1024 * 1024, // 5 MB per file
    maxAssetSize: 10 * 1024 * 1024, // 10 MB per asset
    collaborators: 0,
  },
  pro: {
    projects: 25,
    aiMessagesPerMonth: 500,
    customDomains: 3,
    storageBytes: 5 * 1024 * 1024 * 1024, // 5 GB
    deploysPerMonth: -1, // unlimited
    maxFileSize: 25 * 1024 * 1024, // 25 MB
    maxAssetSize: 50 * 1024 * 1024, // 50 MB
    collaborators: 5,
  },
  business: {
    projects: -1, // unlimited
    aiMessagesPerMonth: 2000,
    customDomains: 10,
    storageBytes: 25 * 1024 * 1024 * 1024, // 25 GB
    deploysPerMonth: -1,
    maxFileSize: 50 * 1024 * 1024, // 50 MB
    maxAssetSize: 100 * 1024 * 1024, // 100 MB
    collaborators: 25,
  },
  enterprise: {
    projects: -1,
    aiMessagesPerMonth: -1,
    customDomains: -1,
    storageBytes: -1,
    deploysPerMonth: -1,
    maxFileSize: 200 * 1024 * 1024, // 200 MB
    maxAssetSize: 500 * 1024 * 1024, // 500 MB
    collaborators: -1,
  },
} as const;

// ─── Supported File Types ────────────────────────────────────
export const EDITABLE_EXTENSIONS = [
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.xml',
  '.svg',
  '.md',
  '.txt',
  '.yaml',
  '.yml',
  '.toml',
] as const;

export const ASSET_MIME_TYPES = {
  image: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'image/avif',
    'image/ico',
  ],
  video: ['video/mp4', 'video/webm', 'video/ogg'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'],
  font: [
    'font/woff',
    'font/woff2',
    'font/ttf',
    'font/otf',
    'application/font-woff',
    'application/font-woff2',
  ],
  document: ['application/pdf'],
} as const;

export const MAX_CHAT_HISTORY_MESSAGES = 50;
// Phase 3: Switched from Opus (slow, expensive) to Sonnet 4 (fast, 5x cheaper)
// Single-pass output needs higher token limit — all files in one response
export const AI_MODEL = 'claude-sonnet-4-20250514';
export const AI_MAX_TOKENS = 16384;

// ─── Editor Language Mapping ─────────────────────────────────
export const FILE_LANGUAGE_MAP: Record<string, string> = {
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.json': 'json',
  '.xml': 'xml',
  '.svg': 'xml',
  '.md': 'markdown',
  '.txt': 'plaintext',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

// ─── Rate Limits ─────────────────────────────────────────────
export const RATE_LIMITS = {
  auth: { windowMs: 15 * 60 * 1000, max: 20 }, // 20 per 15 min
  api: { windowMs: 60 * 1000, max: 120 }, // 120 per minute
  ai: { windowMs: 60 * 1000, max: 10 }, // 10 per minute
  deploy: { windowMs: 60 * 60 * 1000, max: 30 }, // 30 per hour
  upload: { windowMs: 60 * 1000, max: 30 }, // 30 per minute
} as const;

// ─── Billing: Pay-As-You-Go Pricing ─────────────────────────
// All costs in USD cents. Customer price = cost * 1.5 (50% markup)
export const USAGE_COSTS = {
  // AI Tokens (Claude Sonnet 4)
  ai_input_token: {
    costPer1M: 300, // $3.00 per 1M input tokens (our cost)
    pricePer1M: 450, // $4.50 per 1M input tokens (customer pays)
  },
  ai_output_token: {
    costPer1M: 1500, // $15.00 per 1M output tokens (our cost)
    pricePer1M: 2250, // $22.50 per 1M output tokens (customer pays)
  },
  // Simplified: per-message pricing (average ~2K input + 1K output tokens)
  ai_message: {
    costCents: 0.6, // ~$0.006 per message (our cost)
    priceCents: 0.9, // ~$0.009 per message (customer pays)
  },
  // Deploys
  deploy: {
    costCents: 0.5, // $0.005 per deploy (GCS writes)
    priceCents: 0.75, // $0.0075 per deploy (customer pays)
  },
  // Storage (per GB per day)
  storage_gb_day: {
    costCents: 0.07, // ~$0.002/GB/day (GCS)
    priceCents: 0.1, // ~$0.003/GB/day (customer pays)
  },
  // Preview sessions (per minute)
  preview_minute: {
    costCents: 5, // $0.05/min (Novita sandbox)
    priceCents: 7.5, // $0.075/min (customer pays)
  },
  // Custom domains (per domain per day)
  custom_domain_day: {
    costCents: 0, // Free for us (DNS only)
    priceCents: 16.7, // ~$5/month per domain ($0.167/day)
  },
  // Bandwidth (per GB)
  bandwidth_gb: {
    costCents: 12, // $0.12/GB (CDN egress)
    priceCents: 18, // $0.18/GB (customer pays)
  },
} as const;

// Free tier daily limits (no card required)
export const FREE_TIER_LIMITS = {
  ai_messages: 10, // 10 AI messages per day
  deploys: 3, // 3 deploys per day
  storage_mb: 50, // 50 MB total storage
  preview_minutes: 5, // 5 minutes of preview per day
  projects: 2, // 2 projects total
  custom_domains: 0, // No custom domains
  bandwidth_mb: 100, // 100 MB bandwidth per day
} as const;

// Spending alerts (in cents)
export const SPENDING_ALERTS = {
  warning: 500, // $5.00 daily spend warning
  pause: 2000, // $20.00 daily spend — pause account, notify
  hardLimit: 5000, // $50.00 daily spend — hard stop
} as const;

// Legacy plan limits (kept for backward compat, but PAYG is primary)
export const PLAN_LIMITS_LEGACY = PLAN_LIMITS;

// ─── Stripe ──────────────────────────────────────────────────
// Metered billing — usage reported daily to Stripe
export const STRIPE_PRICE_IDS = {
  // Metered prices (created via Stripe API on first deploy)
  payg_ai_tokens: '', // Will be set after Stripe product creation
  payg_deploys: '',
  payg_storage: '',
  payg_preview: '',
  payg_bandwidth: '',
  payg_domains: '',
} as const;
