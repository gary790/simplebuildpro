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
    storageBytes: 100 * 1024 * 1024,       // 100 MB
    deploysPerMonth: 10,
    maxFileSize: 5 * 1024 * 1024,           // 5 MB per file
    maxAssetSize: 10 * 1024 * 1024,         // 10 MB per asset
    collaborators: 0,
  },
  pro: {
    projects: 25,
    aiMessagesPerMonth: 500,
    customDomains: 3,
    storageBytes: 5 * 1024 * 1024 * 1024,   // 5 GB
    deploysPerMonth: -1,                     // unlimited
    maxFileSize: 25 * 1024 * 1024,           // 25 MB
    maxAssetSize: 50 * 1024 * 1024,          // 50 MB
    collaborators: 5,
  },
  business: {
    projects: -1,                            // unlimited
    aiMessagesPerMonth: 2000,
    customDomains: 10,
    storageBytes: 25 * 1024 * 1024 * 1024,  // 25 GB
    deploysPerMonth: -1,
    maxFileSize: 50 * 1024 * 1024,           // 50 MB
    maxAssetSize: 100 * 1024 * 1024,         // 100 MB
    collaborators: 25,
  },
  enterprise: {
    projects: -1,
    aiMessagesPerMonth: -1,
    customDomains: -1,
    storageBytes: -1,
    deploysPerMonth: -1,
    maxFileSize: 200 * 1024 * 1024,          // 200 MB
    maxAssetSize: 500 * 1024 * 1024,         // 500 MB
    collaborators: -1,
  },
} as const;

// ─── Supported File Types ────────────────────────────────────
export const EDITABLE_EXTENSIONS = [
  '.html', '.htm', '.css', '.scss', '.less',
  '.js', '.jsx', '.ts', '.tsx',
  '.json', '.xml', '.svg', '.md', '.txt',
  '.yaml', '.yml', '.toml',
] as const;

export const ASSET_MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/ico'],
  video: ['video/mp4', 'video/webm', 'video/ogg'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'],
  font: ['font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/font-woff', 'application/font-woff2'],
  document: ['application/pdf'],
} as const;

export const MAX_CHAT_HISTORY_MESSAGES = 50;
export const AI_MODEL = 'claude-sonnet-4-20250514';
export const AI_MAX_TOKENS = 8192;

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

// ─── Novita Sandbox ──────────────────────────────────────────
export const NOVITA_SANDBOX_TEMPLATE = 'base';
export const NOVITA_SANDBOX_TIMEOUT_MS = 5 * 60 * 1000; // 5 min default
export const NOVITA_SANDBOX_MAX_TIMEOUT_MS = 30 * 60 * 1000; // 30 min max
export const NOVITA_PREVIEW_PORT = 3000;

// ─── Rate Limits ─────────────────────────────────────────────
export const RATE_LIMITS = {
  auth: { windowMs: 15 * 60 * 1000, max: 20 },         // 20 per 15 min
  api: { windowMs: 60 * 1000, max: 120 },               // 120 per minute
  ai: { windowMs: 60 * 1000, max: 10 },                 // 10 per minute
  deploy: { windowMs: 60 * 60 * 1000, max: 30 },        // 30 per hour
  upload: { windowMs: 60 * 1000, max: 30 },              // 30 per minute
} as const;

// ─── Stripe ──────────────────────────────────────────────────
export const STRIPE_PRICE_IDS = {
  pro_monthly: 'price_pro_monthly',         // Placeholder — replace with real Stripe price IDs
  pro_yearly: 'price_pro_yearly',
  business_monthly: 'price_business_monthly',
  business_yearly: 'price_business_yearly',
} as const;
