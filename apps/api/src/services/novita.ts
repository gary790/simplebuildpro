// ============================================================
// SimpleBuild Pro — Novita Sandbox Service
// Real integration with Novita Agent Sandbox SDK
// Creates isolated preview environments for user websites
// ============================================================

import { Sandbox } from 'novita-sandbox';
import { NOVITA_SANDBOX_TEMPLATE, NOVITA_SANDBOX_TIMEOUT_MS, NOVITA_PREVIEW_PORT } from '@simplebuildpro/shared';
import { AppError } from '../middleware/error-handler';

let novitaServiceInstance: NovitaService | null = null;

function getNovitaApiKey(): string {
  const key = process.env.NOVITA_API_KEY;
  if (!key) {
    throw new AppError(500, 'NOVITA_NOT_CONFIGURED',
      'Novita sandbox is not configured. Set NOVITA_API_KEY environment variable.');
  }
  return key;
}

interface SandboxResult {
  sandboxId: string;
  previewUrl: string;
}

interface SandboxFile {
  path: string;
  content: string;
}

export class NovitaService {
  private apiKey: string;
  private activeSandboxes: Map<string, Sandbox> = new Map();

  constructor() {
    this.apiKey = getNovitaApiKey();
  }

  // ─── Create Preview Sandbox ──────────────────────────────
  // Spins up a real Novita sandbox, writes project files,
  // starts a simple HTTP server, and returns the preview URL
  async createPreviewSandbox(files: SandboxFile[]): Promise<SandboxResult> {
    try {
      // Create sandbox from base template with Node.js support
      const sandbox = await Sandbox.create(NOVITA_SANDBOX_TEMPLATE, {
        apiKey: this.apiKey,
        timeoutMs: NOVITA_SANDBOX_TIMEOUT_MS,
      });

      const sandboxId = sandbox.sandboxId;
      this.activeSandboxes.set(sandboxId, sandbox);

      // Create project directory
      await sandbox.commands.run('mkdir -p /home/user/site');

      // Write all project files to sandbox filesystem
      for (const file of files) {
        const dir = file.path.includes('/')
          ? `/home/user/site/${file.path.substring(0, file.path.lastIndexOf('/'))}`
          : null;
        if (dir) {
          await sandbox.commands.run(`mkdir -p "${dir}"`);
        }
        await sandbox.files.write(`/home/user/site/${file.path}`, file.content);
      }

      // Create a simple Node.js static file server inside the sandbox
      const serverCode = `
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = ${NOVITA_PREVIEW_PORT};
const ROOT = '/home/user/site';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);

  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // If no extension, try .html
  if (!path.extname(filePath)) {
    filePath += '.html';
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try index.html for SPA routing
      fs.readFile(path.join(ROOT, 'index.html'), (err2, fallbackData) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
          res.end(fallbackData);
        }
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Preview server running on port ' + PORT);
});
`;

      await sandbox.files.write('/home/user/server.js', serverCode);

      // Start the preview server in the background
      await sandbox.commands.run('node /home/user/server.js &', {
        background: true,
      });

      // Wait for server to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Get the public preview URL from Novita sandbox
      // Novita sandboxes expose ports via: https://{sandboxId}-{port}.novita.ai
      const previewUrl = `https://${sandboxId}-${NOVITA_PREVIEW_PORT}.novita.ai`;

      return { sandboxId, previewUrl };

    } catch (err) {
      console.error('[Novita] Failed to create sandbox:', err);
      throw new AppError(502, 'SANDBOX_ERROR',
        `Failed to create preview sandbox: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // ─── Update Files in Running Sandbox ─────────────────────
  async updateSandboxFiles(sandboxId: string, files: SandboxFile[]): Promise<void> {
    const sandbox = this.activeSandboxes.get(sandboxId);

    if (!sandbox) {
      // Reconnect to existing sandbox
      try {
        const reconnected = await Sandbox.connect(sandboxId, {
          apiKey: this.apiKey,
        });
        this.activeSandboxes.set(sandboxId, reconnected);
        return this.updateSandboxFiles(sandboxId, files);
      } catch (err) {
        throw new AppError(404, 'SANDBOX_NOT_FOUND',
          'Sandbox no longer exists. Start a new preview.');
      }
    }

    try {
      for (const file of files) {
        const dir = file.path.includes('/')
          ? `/home/user/site/${file.path.substring(0, file.path.lastIndexOf('/'))}`
          : null;
        if (dir) {
          await sandbox.commands.run(`mkdir -p "${dir}"`);
        }
        await sandbox.files.write(`/home/user/site/${file.path}`, file.content);
      }
    } catch (err) {
      console.error('[Novita] Failed to update sandbox files:', err);
      throw new AppError(502, 'SANDBOX_UPDATE_ERROR', 'Failed to update preview files.');
    }
  }

  // ─── Extend Sandbox Timeout ──────────────────────────────
  async extendTimeout(sandboxId: string, timeoutMs: number): Promise<void> {
    const sandbox = this.activeSandboxes.get(sandboxId);
    if (!sandbox) return;

    try {
      await sandbox.setTimeout(timeoutMs);
    } catch (err) {
      console.error('[Novita] Failed to extend sandbox timeout:', err);
    }
  }

  // ─── Check if Sandbox is Alive ───────────────────────────
  async isSandboxAlive(sandboxId: string): Promise<boolean> {
    try {
      const sandbox = this.activeSandboxes.get(sandboxId);
      if (!sandbox) {
        // Try to reconnect
        const reconnected = await Sandbox.connect(sandboxId, {
          apiKey: this.apiKey,
        });
        this.activeSandboxes.set(sandboxId, reconnected);
        return true;
      }

      // Verify with a simple command
      await sandbox.commands.run('echo alive');
      return true;
    } catch {
      this.activeSandboxes.delete(sandboxId);
      return false;
    }
  }

  // ─── Kill Sandbox ────────────────────────────────────────
  async killSandbox(sandboxId: string): Promise<void> {
    try {
      const sandbox = this.activeSandboxes.get(sandboxId);
      if (sandbox) {
        await sandbox.kill();
        this.activeSandboxes.delete(sandboxId);
      } else {
        // Try to connect and kill
        const reconnected = await Sandbox.connect(sandboxId, {
          apiKey: this.apiKey,
        });
        await reconnected.kill();
      }
    } catch (err) {
      console.error('[Novita] Failed to kill sandbox:', err);
      this.activeSandboxes.delete(sandboxId);
    }
  }

  // ─── Get Sandbox Logs ────────────────────────────────────
  async getSandboxLogs(sandboxId: string): Promise<string[]> {
    try {
      const sandbox = this.activeSandboxes.get(sandboxId);
      if (!sandbox) return [];

      const result = await sandbox.commands.run(
        'cat /tmp/preview.log 2>/dev/null || echo "No logs available"'
      );
      return result.stdout.split('\n').filter(Boolean);
    } catch {
      return ['Unable to retrieve logs.'];
    }
  }

  // ─── Execute Command in Sandbox ──────────────────────────
  async executeCommand(sandboxId: string, command: string): Promise<{ stdout: string; stderr: string }> {
    const sandbox = this.activeSandboxes.get(sandboxId);
    if (!sandbox) {
      throw new AppError(404, 'SANDBOX_NOT_FOUND', 'Sandbox not found.');
    }

    try {
      const result = await sandbox.commands.run(command);
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (err) {
      throw new AppError(502, 'COMMAND_ERROR',
        `Command failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────
  async cleanupAll(): Promise<void> {
    for (const [id, sandbox] of this.activeSandboxes) {
      try {
        await sandbox.kill();
      } catch { /* ignore cleanup errors */ }
    }
    this.activeSandboxes.clear();
  }
}

export function getNovitaService(): NovitaService {
  if (!novitaServiceInstance) {
    novitaServiceInstance = new NovitaService();
  }
  return novitaServiceInstance;
}

// Cleanup on process exit
process.on('SIGTERM', async () => {
  if (novitaServiceInstance) {
    await novitaServiceInstance.cleanupAll();
  }
});

process.on('SIGINT', async () => {
  if (novitaServiceInstance) {
    await novitaServiceInstance.cleanupAll();
  }
});
