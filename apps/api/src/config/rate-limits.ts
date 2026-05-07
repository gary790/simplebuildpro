// ============================================================
// SimpleBuild Pro — Rate Limit Configuration
// Environment-specific rate limiting rules
// ============================================================

export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitConfig {
  default: RateLimitRule;
  auth: RateLimitRule;
  api: RateLimitRule;
  ai: RateLimitRule;
  deploy: RateLimitRule;
  upload: RateLimitRule;
  admin: RateLimitRule;
}

const rateLimitConfigs: Record<string, RateLimitConfig> = {
  development: {
    default: { windowMs: 60000, maxRequests: 200 },
    auth: { windowMs: 60000, maxRequests: 30 },
    api: { windowMs: 60000, maxRequests: 150 },
    ai: { windowMs: 60000, maxRequests: 50 },
    deploy: { windowMs: 300000, maxRequests: 20 },
    upload: { windowMs: 60000, maxRequests: 30 },
    admin: { windowMs: 60000, maxRequests: 100 },
  },
  staging: {
    default: { windowMs: 60000, maxRequests: 100 },
    auth: { windowMs: 60000, maxRequests: 10 },
    api: { windowMs: 60000, maxRequests: 80 },
    ai: { windowMs: 60000, maxRequests: 30 },
    deploy: { windowMs: 300000, maxRequests: 10 },
    upload: { windowMs: 60000, maxRequests: 20 },
    admin: { windowMs: 60000, maxRequests: 50 },
  },
  production: {
    default: { windowMs: 60000, maxRequests: 60 },
    auth: { windowMs: 60000, maxRequests: 5 },
    api: { windowMs: 60000, maxRequests: 60 },
    ai: { windowMs: 60000, maxRequests: 20 },
    deploy: { windowMs: 300000, maxRequests: 5 },
    upload: { windowMs: 60000, maxRequests: 10 },
    admin: { windowMs: 60000, maxRequests: 30 },
  },
};

export function getRateLimitConfig(env?: string): RateLimitConfig {
  const environment = env || process.env.NODE_ENV || 'development';
  return rateLimitConfigs[environment] || rateLimitConfigs.development;
}
