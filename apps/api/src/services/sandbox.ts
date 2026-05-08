// ============================================================
// SimpleBuild Pro — E2B Sandbox Service
// Manages per-project Linux sandboxes for AI code execution
// Create, pause, resume, exec, file ops, snapshot
// ============================================================

import { Sandbox } from 'e2b';
import { logger } from './logger';

// ─── Configuration ──────────────────────────────────────────
const E2B_API_KEY = process.env.E2B_API_KEY || '';
const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour max
const SANDBOX_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min idle → auto-pause

if (!E2B_API_KEY) {
  logger.warn('[Sandbox] E2B_API_KEY not set — sandbox features disabled');
}

// ─── In-memory sandbox registry ─────────────────────────────
// Maps projectId → active Sandbox instance
const activeSandboxes = new Map<string, {
  sandbox: Sandbox;
  projectId: string;
  createdAt: Date;
  lastActiveAt: Date;
}>();

// ─── Types ──────────────────────────────────────────────────
export interface SandboxInfo {
  sandboxId: string;
  projectId: string;
  status: 'running' | 'paused' | 'creating' | 'error';
  previewUrl: string | null;
  createdAt: string;
  lastActiveAt: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface FileInfo {
  path: string;
  name: string;
  isDir: boolean;
  size?: number;
}

// ─── Create or get sandbox for a project ────────────────────
export async function getOrCreateSandbox(projectId: string): Promise<SandboxInfo> {
  // Check if we already have an active sandbox
  const existing = activeSandboxes.get(projectId);
  if (existing) {
    existing.lastActiveAt = new Date();
    const previewUrl = getPreviewUrl(existing.sandbox);
    return {
      sandboxId: existing.sandbox.sandboxId,
      projectId,
      status: 'running',
      previewUrl,
      createdAt: existing.createdAt.toISOString(),
      lastActiveAt: existing.lastActiveAt.toISOString(),
    };
  }

  // Create a new sandbox
  logger.info(`[Sandbox] Creating new sandbox for project ${projectId}`);

  const sandbox = await Sandbox.create({
    apiKey: E2B_API_KEY,
    timeoutMs: SANDBOX_TIMEOUT_MS,
    metadata: { projectId },
  });

  // Set up the project directory and install a basic dev server
  await sandbox.commands.run('mkdir -p /home/user/project', { timeoutMs: 10000 });

  // Install a simple static file server for preview
  await sandbox.commands.run(
    'cd /home/user/project && npm init -y --silent 2>/dev/null && npm install --silent serve 2>/dev/null',
    { timeoutMs: 60000 },
  );

  const now = new Date();
  activeSandboxes.set(projectId, {
    sandbox,
    projectId,
    createdAt: now,
    lastActiveAt: now,
  });

  const previewUrl = getPreviewUrl(sandbox);

  logger.info(`[Sandbox] Created sandbox ${sandbox.sandboxId} for project ${projectId}, preview: ${previewUrl}`);

  return {
    sandboxId: sandbox.sandboxId,
    projectId,
    status: 'running',
    previewUrl,
    createdAt: now.toISOString(),
    lastActiveAt: now.toISOString(),
  };
}

// ─── Get sandbox (no create) ────────────────────────────────
export function getActiveSandbox(projectId: string): Sandbox | null {
  const entry = activeSandboxes.get(projectId);
  if (entry) {
    entry.lastActiveAt = new Date();
    return entry.sandbox;
  }
  return null;
}

// ─── Get preview URL for port 3000 ─────────────────────────
function getPreviewUrl(sandbox: Sandbox): string {
  try {
    return `https://${sandbox.getHost(3000)}`;
  } catch {
    return '';
  }
}

// ─── Execute a command in the sandbox ───────────────────────
export async function execCommand(
  projectId: string,
  command: string,
  timeoutMs = 30000,
): Promise<ExecResult> {
  const sandbox = getActiveSandbox(projectId);
  if (!sandbox) throw new Error(`No active sandbox for project ${projectId}`);

  logger.info(`[Sandbox] Exec in ${projectId}: ${command.slice(0, 200)}`);

  const result = await sandbox.commands.run(command, {
    timeoutMs,
    cwd: '/home/user/project',
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.exitCode,
  };
}

// ─── Write a file to the sandbox ────────────────────────────
export async function writeFile(
  projectId: string,
  filePath: string,
  content: string,
): Promise<void> {
  const sandbox = getActiveSandbox(projectId);
  if (!sandbox) throw new Error(`No active sandbox for project ${projectId}`);

  // Ensure path is within the project directory
  const fullPath = filePath.startsWith('/') ? filePath : `/home/user/project/${filePath}`;

  // Create parent directories
  const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  if (dir) {
    await sandbox.commands.run(`mkdir -p "${dir}"`, { timeoutMs: 5000 });
  }

  await sandbox.files.write(fullPath, content);

  logger.info(`[Sandbox] Wrote file: ${filePath} (${content.length} bytes) in project ${projectId}`);
}

// ─── Read a file from the sandbox ───────────────────────────
export async function readFile(
  projectId: string,
  filePath: string,
): Promise<string> {
  const sandbox = getActiveSandbox(projectId);
  if (!sandbox) throw new Error(`No active sandbox for project ${projectId}`);

  const fullPath = filePath.startsWith('/') ? filePath : `/home/user/project/${filePath}`;
  const content = await sandbox.files.read(fullPath);

  return content;
}

// ─── List files in the sandbox ──────────────────────────────
export async function listFiles(
  projectId: string,
  dirPath = '.',
): Promise<FileInfo[]> {
  const sandbox = getActiveSandbox(projectId);
  if (!sandbox) throw new Error(`No active sandbox for project ${projectId}`);

  const fullPath = dirPath.startsWith('/') ? dirPath : `/home/user/project/${dirPath}`;

  // Use find command to get a structured listing (excluding node_modules, .git)
  const result = await sandbox.commands.run(
    `find "${fullPath}" -maxdepth 5 -not -path "*/node_modules/*" -not -path "*/.git/*" -not -name "node_modules" -not -name ".git" -printf "%y|%s|%p\\n" 2>/dev/null | head -500`,
    { timeoutMs: 10000, cwd: '/home/user/project' },
  );

  const files: FileInfo[] = [];
  const projectRoot = '/home/user/project/';

  for (const line of (result.stdout || '').split('\n')) {
    if (!line.trim()) continue;
    const [type, sizeStr, absPath] = line.split('|');
    if (!absPath) continue;

    const relativePath = absPath.startsWith(projectRoot)
      ? absPath.slice(projectRoot.length)
      : absPath;

    if (!relativePath || relativePath === '.') continue;

    files.push({
      path: relativePath,
      name: relativePath.split('/').pop() || relativePath,
      isDir: type === 'd',
      size: parseInt(sizeStr) || 0,
    });
  }

  return files;
}

// ─── Start the dev server in the sandbox ────────────────────
export async function startDevServer(projectId: string): Promise<string> {
  const sandbox = getActiveSandbox(projectId);
  if (!sandbox) throw new Error(`No active sandbox for project ${projectId}`);

  // Kill any existing server on port 3000
  await sandbox.commands.run('fuser -k 3000/tcp 2>/dev/null || true', { timeoutMs: 5000 });

  // Start a static file server in the background
  // Using `npx serve` which is installed in the project
  sandbox.commands.run(
    'cd /home/user/project && npx serve -l 3000 -s --no-clipboard 2>&1',
    { timeoutMs: SANDBOX_TIMEOUT_MS, background: true },
  ).catch(() => { /* background process — ignore errors */ });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  const previewUrl = getPreviewUrl(sandbox);
  logger.info(`[Sandbox] Dev server started for project ${projectId}: ${previewUrl}`);

  return previewUrl;
}

// ─── Stop sandbox (pause/kill) ──────────────────────────────
export async function stopSandbox(projectId: string): Promise<void> {
  const entry = activeSandboxes.get(projectId);
  if (!entry) return;

  try {
    await entry.sandbox.kill();
    logger.info(`[Sandbox] Stopped sandbox for project ${projectId}`);
  } catch (err: any) {
    logger.error(`[Sandbox] Error stopping sandbox: ${err.message}`);
  } finally {
    activeSandboxes.delete(projectId);
  }
}

// ─── Get sandbox status ─────────────────────────────────────
export function getSandboxStatus(projectId: string): SandboxInfo | null {
  const entry = activeSandboxes.get(projectId);
  if (!entry) return null;

  return {
    sandboxId: entry.sandbox.sandboxId,
    projectId,
    status: 'running',
    previewUrl: getPreviewUrl(entry.sandbox),
    createdAt: entry.createdAt.toISOString(),
    lastActiveAt: entry.lastActiveAt.toISOString(),
  };
}

// ─── Restore project files from DB into sandbox ─────────────
export async function restoreFilesFromDB(
  projectId: string,
  files: { path: string; content: string }[],
): Promise<number> {
  const sandbox = getActiveSandbox(projectId);
  if (!sandbox) throw new Error(`No active sandbox for project ${projectId}`);

  let restored = 0;
  for (const file of files) {
    try {
      const fullPath = `/home/user/project/${file.path}`;
      const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
      if (dir) {
        await sandbox.commands.run(`mkdir -p "${dir}"`, { timeoutMs: 5000 });
      }
      await sandbox.files.write(fullPath, file.content);
      restored++;
    } catch (err: any) {
      logger.error(`[Sandbox] Failed to restore file ${file.path}: ${err.message}`);
    }
  }

  logger.info(`[Sandbox] Restored ${restored}/${files.length} files for project ${projectId}`);
  return restored;
}

// ─── Snapshot project files from sandbox back to DB format ──
export async function snapshotFiles(
  projectId: string,
): Promise<{ path: string; content: string }[]> {
  const fileList = await listFiles(projectId, '.');
  const results: { path: string; content: string }[] = [];

  for (const file of fileList) {
    if (file.isDir) continue;
    // Skip large files and binary files
    if (file.size && file.size > 500000) continue;
    if (/\.(png|jpg|jpeg|gif|ico|woff|woff2|ttf|eot|mp3|mp4|zip|tar|gz)$/i.test(file.path)) continue;

    try {
      const content = await readFile(projectId, file.path);
      results.push({ path: file.path, content });
    } catch {
      // Skip unreadable files
    }
  }

  logger.info(`[Sandbox] Snapshot: ${results.length} files from project ${projectId}`);
  return results;
}

// ─── Cleanup idle sandboxes (run periodically) ──────────────
export function cleanupIdleSandboxes(): void {
  const now = Date.now();
  for (const [projectId, entry] of activeSandboxes) {
    const idle = now - entry.lastActiveAt.getTime();
    if (idle > SANDBOX_IDLE_TIMEOUT_MS) {
      logger.info(`[Sandbox] Auto-stopping idle sandbox for project ${projectId} (idle ${Math.round(idle / 60000)}min)`);
      stopSandbox(projectId).catch(() => {});
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupIdleSandboxes, 5 * 60 * 1000);
