// ============================================================
// SimpleBuild Pro — CORS Configuration
// Environment-specific CORS origins
// ============================================================

export interface CorsConfig {
  origins: string[];
  methods: string[];
  headers: string[];
  credentials: boolean;
  maxAge: number;
}

const corsConfigs: Record<string, CorsConfig> = {
  development: {
    origins: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 3600,
  },
  staging: {
    origins: ['https://staging.simplebuildpro.com', 'https://staging-app.simplebuildpro.com'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  },
  production: {
    origins: [
      'https://app.simplebuildpro.com',
      'https://simplebuildpro.com',
      'https://www.simplebuildpro.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    headers: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  },
};

export function getCorsConfig(env?: string): CorsConfig {
  const environment = env || process.env.NODE_ENV || 'development';
  return corsConfigs[environment] || corsConfigs.development;
}
