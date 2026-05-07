// ============================================================
// SimpleBuild Pro — PM2 Ecosystem Configuration
// Local development server management
// ============================================================

module.exports = {
  apps: [
    {
      name: 'simplebuildpro-api',
      cwd: './apps/api',
      script: 'npx',
      args: 'tsx watch src/index.ts',
      env: {
        NODE_ENV: 'development',
        PORT: 8080,
        DATABASE_URL: 'postgresql://sbuser:sbpass123@localhost:5432/simplebuildpro',
        JWT_SECRET: 'dev-jwt-secret-not-for-production-use-change-me-please',
        GCP_PROJECT_ID: 'simplebuildpro',
        GCS_BUCKET_ASSETS: 'simplebuildpro-assets',
        GCS_BUCKET_BUILDS: 'simplebuildpro-builds',
        GCS_BUCKET_DEPLOYS: 'simplebuildpro-deploys',
        GCS_BUCKET_SNAPSHOTS: 'simplebuildpro-snapshots',
        CDN_URL: 'https://cdn.simplebuildpro.com',
        SITES_DOMAIN: 'sites.simplebuildpro.com',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'simplebuildpro-web',
      cwd: './apps/web',
      script: 'npx',
      args: 'next dev --port 3000',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        NEXT_PUBLIC_API_URL: 'http://localhost:8080',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
