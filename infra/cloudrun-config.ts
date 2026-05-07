// ============================================================
// SimpleBuild Pro — Cloud Run Service Configuration
// Defines service-level settings for Cloud Run deployments
// ============================================================

export const cloudRunConfig = {
  // ─── API Service ─────────────────────────────────────────────────
  api: {
    name: 'simplebuildpro-api',
    port: 8080,
    memory: '512Mi',
    cpu: '1',
    minInstances: 1,
    maxInstances: 10,
    concurrency: 80,
    timeout: '60s',
    healthCheck: {
      path: '/health/live',
      initialDelaySeconds: 5,
      periodSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    readinessCheck: {
      path: '/health/ready',
      initialDelaySeconds: 10,
      periodSeconds: 15,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    startupCheck: {
      path: '/health/startup',
      initialDelaySeconds: 0,
      periodSeconds: 2,
      timeoutSeconds: 5,
      failureThreshold: 15, // 30s max startup time
    },
    scaling: {
      targetCPUUtilization: 70,
      targetMemoryUtilization: 80,
      targetConcurrency: 60,
    },
  },

  // ─── Web Service ─────────────────────────────────────────────────
  web: {
    name: 'simplebuildpro-web',
    port: 3000,
    memory: '512Mi',
    cpu: '1',
    minInstances: 1,
    maxInstances: 5,
    concurrency: 100,
    timeout: '60s',
    healthCheck: {
      path: '/api/health',
      initialDelaySeconds: 10,
      periodSeconds: 10,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    scaling: {
      targetCPUUtilization: 70,
      targetMemoryUtilization: 80,
      targetConcurrency: 80,
    },
  },

  // ─── Cloud SQL ───────────────────────────────────────────────────
  database: {
    instanceName: 'simplebuildpro-db',
    version: 'POSTGRES_16',
    tier: 'db-custom-2-4096',
    region: 'us-central1',
    highAvailability: true,
    backupEnabled: true,
    backupTime: '03:00',
    maintenanceWindow: { day: 'SUN', hour: 4 },
    flags: {
      max_connections: 200,
      log_min_duration_statement: 1000,
      shared_buffers: '256MB',
      work_mem: '4MB',
    },
    insights: {
      queryInsightsEnabled: true,
      recordApplicationTags: true,
      recordClientAddress: true,
    },
  },

  // ─── Memorystore (Redis) ─────────────────────────────────────────
  redis: {
    name: 'simplebuildpro-redis',
    tier: 'BASIC',
    memorySizeGb: 1,
    version: 'REDIS_7_0',
    region: 'us-central1',
  },

  // ─── Load Balancer ───────────────────────────────────────────────
  loadBalancer: {
    domains: {
      api: 'api.simplebuildpro.com',
      web: 'app.simplebuildpro.com',
      www: 'www.simplebuildpro.com',
    },
    ssl: {
      managed: true,
      minTlsVersion: 'TLS_1_2',
    },
    cdn: {
      enabled: true,
      cacheMode: 'CACHE_ALL_STATIC',
      defaultTtl: 3600,
    },
  },

  // ─── Alerting Policies ───────────────────────────────────────────
  alerts: {
    errorRate: {
      threshold: 5, // 5% error rate
      duration: '300s',
      severity: 'CRITICAL',
    },
    latencyP95: {
      threshold: 2000, // 2 seconds
      duration: '300s',
      severity: 'WARNING',
    },
    memoryUsage: {
      threshold: 80, // 80% memory
      duration: '300s',
      severity: 'WARNING',
    },
    instanceCount: {
      threshold: 8, // 80% of max
      duration: '600s',
      severity: 'WARNING',
    },
  },
};

export type CloudRunConfig = typeof cloudRunConfig;
