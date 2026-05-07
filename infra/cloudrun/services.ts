// ============================================================
// SimpleBuild Pro — Cloud Run Service Configuration
// Defines Cloud Run deployment specifications
// ============================================================

export interface ServiceConfig {
  name: string;
  image: string;
  port: number;
  memory: string;
  cpu: string;
  minInstances: number;
  maxInstances: number;
  concurrency: number;
  timeout: string;
  env: Record<string, string>;
  secrets: string[];
  cloudsqlInstances?: string[];
  vpcConnector?: string;
  ingressSettings?: 'all' | 'internal' | 'internal-and-cloud-load-balancing';
}

export const services: Record<string, ServiceConfig> = {
  api: {
    name: 'simplebuildpro-api',
    image: 'us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/api',
    port: 8080,
    memory: '512Mi',
    cpu: '1',
    minInstances: 1,
    maxInstances: 10,
    concurrency: 80,
    timeout: '60s',
    env: {
      NODE_ENV: 'production',
      PORT: '8080',
    },
    secrets: [
      'DATABASE_URL=simplebuildpro-database-url:latest',
      'REDIS_URL=simplebuildpro-redis-url:latest',
      'JWT_SECRET=simplebuildpro-jwt-secret:latest',
      'JWT_REFRESH_SECRET=simplebuildpro-jwt-refresh-secret:latest',
      'GOOGLE_CLIENT_ID=simplebuildpro-google-client-id:latest',
      'GOOGLE_CLIENT_SECRET=simplebuildpro-google-client-secret:latest',
      'GITHUB_CLIENT_ID=simplebuildpro-github-client-id:latest',
      'GITHUB_CLIENT_SECRET=simplebuildpro-github-client-secret:latest',
      'STRIPE_SECRET_KEY=simplebuildpro-stripe-secret-key:latest',
      'STRIPE_WEBHOOK_SECRET=simplebuildpro-stripe-webhook-secret:latest',
      'ANTHROPIC_API_KEY=simplebuildpro-anthropic-api-key:latest',
      'GCS_BUCKET=simplebuildpro-gcs-bucket:latest',
      'NOVITA_API_KEY=simplebuildpro-novita-api-key:latest',
      'PAGESPEED_API_KEY=simplebuildpro-pagespeed-api-key:latest',
    ],
    cloudsqlInstances: ['simplebuildpro:us-central1:simplebuildpro-db'],
    vpcConnector: 'simplebuildpro-vpc-connector',
    ingressSettings: 'internal-and-cloud-load-balancing',
  },
  web: {
    name: 'simplebuildpro-web',
    image: 'us-central1-docker.pkg.dev/simplebuildpro/simplebuildpro/web',
    port: 3000,
    memory: '512Mi',
    cpu: '1',
    minInstances: 1,
    maxInstances: 5,
    concurrency: 100,
    timeout: '60s',
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_URL: 'https://api.simplebuildpro.com',
      NEXT_PUBLIC_APP_URL: 'https://app.simplebuildpro.com',
    },
    secrets: [],
    ingressSettings: 'all',
  },
};

// Cloud Run health check configuration
export const healthChecks = {
  api: {
    startupProbe: {
      httpGet: { path: '/health/startup', port: 8080 },
      initialDelaySeconds: 5,
      periodSeconds: 2,
      failureThreshold: 15,
      timeoutSeconds: 3,
    },
    livenessProbe: {
      httpGet: { path: '/health/live', port: 8080 },
      initialDelaySeconds: 10,
      periodSeconds: 30,
      failureThreshold: 3,
      timeoutSeconds: 5,
    },
    readinessProbe: {
      httpGet: { path: '/health/ready', port: 8080 },
      initialDelaySeconds: 5,
      periodSeconds: 10,
      failureThreshold: 3,
      timeoutSeconds: 5,
    },
  },
  web: {
    startupProbe: {
      httpGet: { path: '/api/health', port: 3000 },
      initialDelaySeconds: 10,
      periodSeconds: 3,
      failureThreshold: 10,
      timeoutSeconds: 3,
    },
    livenessProbe: {
      httpGet: { path: '/api/health', port: 3000 },
      initialDelaySeconds: 15,
      periodSeconds: 30,
      failureThreshold: 3,
      timeoutSeconds: 5,
    },
  },
};
