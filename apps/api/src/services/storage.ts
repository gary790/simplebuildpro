// ============================================================
// SimpleBuild Pro — Google Cloud Storage Service
// Real GCS integration for asset storage, builds, and deploys
// ============================================================

import { Storage } from '@google-cloud/storage';

let storageInstance: StorageService | null = null;

export interface UploadOptions {
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export class StorageService {
  private storage: Storage;

  constructor() {
    // In production on Cloud Run, ADC (Application Default Credentials) is automatic
    // In development, set GOOGLE_APPLICATION_CREDENTIALS env var to service account key
    this.storage = new Storage({
      projectId: process.env.GCP_PROJECT_ID || 'simplebuildpro',
    });
  }

  async upload(bucket: string, key: string, data: Buffer, options: UploadOptions): Promise<string> {
    const file = this.storage.bucket(bucket).file(key);

    await file.save(data, {
      contentType: options.contentType,
      metadata: {
        cacheControl: options.cacheControl || 'public, max-age=3600',
        metadata: options.metadata || {},
      },
      resumable: data.length > 5 * 1024 * 1024, // Resume for files > 5MB
    });

    return `gs://${bucket}/${key}`;
  }

  async download(bucket: string, key: string): Promise<Buffer> {
    const file = this.storage.bucket(bucket).file(key);
    const [data] = await file.download();
    return data;
  }

  async delete(bucket: string, key: string): Promise<void> {
    const file = this.storage.bucket(bucket).file(key);
    await file.delete({ ignoreNotFound: true });
  }

  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    const [files] = await this.storage.bucket(bucket).getFiles({ prefix });
    let deleted = 0;
    for (const file of files) {
      await file.delete({ ignoreNotFound: true });
      deleted++;
    }
    return deleted;
  }

  async exists(bucket: string, key: string): Promise<boolean> {
    const file = this.storage.bucket(bucket).file(key);
    const [exists] = await file.exists();
    return exists;
  }

  async getSignedUploadUrl(
    bucket: string,
    key: string,
    contentType: string,
    expiresInMs: number = 3600_000
  ): Promise<string> {
    const file = this.storage.bucket(bucket).file(key);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + expiresInMs,
      contentType,
    });
    return url;
  }

  async getSignedDownloadUrl(
    bucket: string,
    key: string,
    expiresInMs: number = 3600_000
  ): Promise<string> {
    const file = this.storage.bucket(bucket).file(key);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expiresInMs,
    });
    return url;
  }

  async listFiles(bucket: string, prefix: string): Promise<{ name: string; size: number }[]> {
    const [files] = await this.storage.bucket(bucket).getFiles({ prefix });
    return files.map(f => ({
      name: f.name,
      size: parseInt(f.metadata.size as string || '0', 10),
    }));
  }

  async copyFile(
    sourceBucket: string,
    sourceKey: string,
    destBucket: string,
    destKey: string
  ): Promise<void> {
    const sourceFile = this.storage.bucket(sourceBucket).file(sourceKey);
    const destFile = this.storage.bucket(destBucket).file(destKey);
    await sourceFile.copy(destFile);
  }

  // Upload multiple files in parallel (for deploys)
  async uploadBatch(
    bucket: string,
    files: { key: string; data: Buffer; contentType: string; cacheControl?: string }[],
    concurrency: number = 10
  ): Promise<number> {
    let uploaded = 0;
    const queue = [...files];

    const worker = async () => {
      while (queue.length > 0) {
        const file = queue.shift();
        if (!file) break;
        await this.upload(bucket, file.key, file.data, {
          contentType: file.contentType,
          cacheControl: file.cacheControl || 'public, max-age=31536000, immutable',
        });
        uploaded++;
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
    await Promise.all(workers);

    return uploaded;
  }
}

export function getStorageService(): StorageService {
  if (!storageInstance) {
    storageInstance = new StorageService();
  }
  return storageInstance;
}
