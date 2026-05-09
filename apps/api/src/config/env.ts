// ============================================================
// SimpleBuild Pro — Environment Configuration
// Typed, validated environment variable access
// ============================================================

interface EnvConfig {
  // Server
  NODE_ENV: 'development' | 'staging' | 'production';
  PORT: number;
  APP_VERSION: string;

  // URLs
  APP_URL: string;
  API_URL: string;

  // Database
  DATABASE_URL: string;

  // Redis
  REDIS_URL: string;

  // Authentication
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_EXPIRY: number; // seconds
  JWT_REFRESH_EXPIRY: number; // seconds

  // OAuth
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;

  // Stripe
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;

  // AI
  ANTHROPIC_API_KEY: string;

  // Storage
  GCS_BUCKET: string;

  // Preview
  NOVITA_API_KEY: string;

  // Lighthouse
  PAGESPEED_API_KEY: string;

  // GCP
  GCP_PROJECT_ID: string;
  GCP_REGION: string;

  // Cloud SQL
  CLOUD_SQL_CONNECTION_NAME: string;
}

const defaults: Partial<EnvConfig> = {
  NODE_ENV: 'development',
  PORT: 8080,
  APP_VERSION: '1.0.0',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:8080',
  JWT_EXPIRY: 900, // 15 minutes
  JWT_REFRESH_EXPIRY: 2592000, // 30 days
  GCP_PROJECT_ID: 'simplebuildpro',
  GCP_REGION: 'us-central1',
};

// Required in production
const REQUIRED_PRODUCTION: (keyof EnvConfig)[] = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'STRIPE_SECRET_KEY',
  'ANTHROPIC_API_KEY',
  'GCS_BUCKET',
];

// Required in all environments
const REQUIRED_ALWAYS: (keyof EnvConfig)[] = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];

/**
 * Load and validate environment configuration
 */
export function loadConfig(): EnvConfig {
  const env = process.env;
  const nodeEnv = (env.NODE_ENV || 'development') as EnvConfig['NODE_ENV'];

  const config: EnvConfig = {
    NODE_ENV: nodeEnv,
    PORT: parseInt(env.PORT || String(defaults.PORT)),
    APP_VERSION: env.APP_VERSION || defaults.APP_VERSION!,
    APP_URL: env.APP_URL || defaults.APP_URL!,
    API_URL: env.API_URL || defaults.API_URL!,
    DATABASE_URL: env.DATABASE_URL || '',
    REDIS_URL: env.REDIS_URL || '',
    JWT_SECRET: env.JWT_SECRET || '',
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET || '',
    JWT_EXPIRY: parseInt(env.JWT_EXPIRY || String(defaults.JWT_EXPIRY)),
    JWT_REFRESH_EXPIRY: parseInt(env.JWT_REFRESH_EXPIRY || String(defaults.JWT_REFRESH_EXPIRY)),
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || '',
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID || '',
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET || '',
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY || '',
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET || '',
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || '',
    GCS_BUCKET: env.GCS_BUCKET || '',
    NOVITA_API_KEY: env.NOVITA_API_KEY || '',
    PAGESPEED_API_KEY: env.PAGESPEED_API_KEY || '',
    GCP_PROJECT_ID: env.GCP_PROJECT_ID || defaults.GCP_PROJECT_ID!,
    GCP_REGION: env.GCP_REGION || defaults.GCP_REGION!,
    CLOUD_SQL_CONNECTION_NAME: env.CLOUD_SQL_CONNECTION_NAME || '',
  };

  // Validate required vars
  const missing: string[] = [];

  for (const key of REQUIRED_ALWAYS) {
    if (!config[key]) missing.push(key);
  }

  if (nodeEnv === 'production') {
    for (const key of REQUIRED_PRODUCTION) {
      if (!config[key]) missing.push(key);
    }
  }

  if (missing.length > 0 && nodeEnv === 'production') {
    throw new Error(`Missing required environment variables for ${nodeEnv}: ${missing.join(', ')}`);
  } else if (missing.length > 0) {
    console.warn(
      `⚠️  Missing environment variables (non-critical in ${nodeEnv}): ${missing.join(', ')}`,
    );
  }

  return config;
}

// Singleton config instance
let _config: EnvConfig | null = null;

export function getConfig(): EnvConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function resetConfig(): void {
  _config = null;
}

export type { EnvConfig };
