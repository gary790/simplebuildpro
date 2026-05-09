// ============================================================
// SimpleBuild Pro — WebContainer Service (Phase 3)
// Browser-based Node.js runtime via StackBlitz WebContainer API.
// Zero latency, zero cost, instant preview.
// ============================================================

import { WebContainer } from '@webcontainer/api';

let instance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;
let serverUrl: string | null = null;

// ─── Boot WebContainer (singleton) ───────────────────────────
export async function boot(): Promise<WebContainer> {
  if (instance) return instance;
  if (bootPromise) return bootPromise;

  bootPromise = (async () => {
    console.log('[WebContainer] Booting...');
    const startTime = performance.now();

    instance = await WebContainer.boot();

    const elapsed = Math.round(performance.now() - startTime);
    console.log(`[WebContainer] Booted in ${elapsed}ms`);

    // Listen for server-ready events
    instance.on('server-ready', (_port: number, url: string) => {
      console.log(`[WebContainer] Server ready on port ${_port}: ${url}`);
      serverUrl = url;
    });

    return instance;
  })();

  return bootPromise;
}

// ─── Get current instance (null if not booted) ───────────────
export function getInstance(): WebContainer | null {
  return instance;
}

// ─── Get the dev server URL ──────────────────────────────────
export function getServerUrl(): string | null {
  return serverUrl;
}

// ─── Write a single file ─────────────────────────────────────
export async function writeFile(path: string, content: string): Promise<void> {
  if (!instance) throw new Error('WebContainer not booted');

  // Ensure parent directories exist
  const parts = path.split('/');
  if (parts.length > 1) {
    const dir = parts.slice(0, -1).join('/');
    await mkdirp(dir);
  }

  await instance.fs.writeFile(path, content);
}

// ─── Read a single file ──────────────────────────────────────
export async function readFile(path: string): Promise<string> {
  if (!instance) throw new Error('WebContainer not booted');
  return await instance.fs.readFile(path, 'utf-8');
}

// ─── Create directory recursively ────────────────────────────
async function mkdirp(dirPath: string): Promise<void> {
  if (!instance) return;
  const parts = dirPath.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    try {
      await instance.fs.mkdir(current);
    } catch {
      // Directory may already exist
    }
  }
}

// ─── Write multiple files at once ────────────────────────────
export async function writeFiles(files: Record<string, string>): Promise<void> {
  if (!instance) throw new Error('WebContainer not booted');

  for (const [path, content] of Object.entries(files)) {
    await writeFile(path, content);
  }
}

// ─── Mount a file tree (for initial project load) ────────────
export async function mountFiles(files: Map<string, string>): Promise<void> {
  if (!instance) throw new Error('WebContainer not booted');

  // Convert Map to WebContainer FileSystemTree format
  const tree: Record<string, any> = {};

  for (const [path, content] of files.entries()) {
    const parts = path.split('/');
    let current = tree;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = { directory: {} };
      }
      current = current[part].directory;
    }

    const fileName = parts[parts.length - 1];
    current[fileName] = {
      file: { contents: content },
    };
  }

  await instance.mount(tree);
}

// ─── List files recursively ──────────────────────────────────
export async function listFiles(dirPath: string = '.'): Promise<string[]> {
  if (!instance) throw new Error('WebContainer not booted');

  const results: string[] = [];

  async function walk(dir: string, prefix: string) {
    try {
      const entries = await instance!.fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          // Skip node_modules and .git
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          await walk(`${dir}/${entry.name}`, fullPath);
        } else {
          results.push(fullPath);
        }
      }
    } catch {
      // Directory may not exist
    }
  }

  await walk(dirPath, '');
  return results;
}

// ─── Run a shell command ─────────────────────────────────────
export async function runCommand(
  command: string,
  args: string[] = [],
  onOutput?: (data: string) => void,
): Promise<{ exitCode: number; output: string }> {
  if (!instance) throw new Error('WebContainer not booted');

  const process = await instance.spawn(command, args);
  let output = '';

  // WebContainer output stream yields strings directly (not bytes)
  const reader = process.output.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += value;
      onOutput?.(value);
    }
  } catch {
    // Stream ended
  }

  const exitCode = await process.exit;
  return { exitCode, output };
}

// ─── Start a dev server (for preview) ────────────────────────
export async function startDevServer(onOutput?: (data: string) => void): Promise<string | null> {
  if (!instance) throw new Error('WebContainer not booted');

  // Check if there's a package.json — if so, install deps and start
  try {
    const packageJson = await readFile('package.json');
    if (packageJson) {
      console.log('[WebContainer] Found package.json, installing dependencies...');
      onOutput?.('Installing dependencies...\n');

      const installResult = await runCommand('npm', ['install'], onOutput);
      if (installResult.exitCode !== 0) {
        console.warn('[WebContainer] npm install failed:', installResult.output.slice(-500));
      }

      // Start dev server
      console.log('[WebContainer] Starting dev server...');
      onOutput?.('Starting dev server...\n');

      const serverProcess = await instance.spawn('npm', ['run', 'dev']);

      // Read output in background (stream yields strings directly)
      const reader = serverProcess.output.getReader();
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            onOutput?.(value);
          }
        } catch {
          /* stream ended */
        }
      })();

      // Wait for server-ready event
      return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(serverUrl), 15000);
        instance!.on('server-ready', (_port: number, url: string) => {
          clearTimeout(timeout);
          serverUrl = url;
          resolve(url);
        });
      });
    }
  } catch {
    // No package.json — static project, no dev server needed
  }

  return null;
}

// ─── Teardown ────────────────────────────────────────────────
export function teardown(): void {
  if (instance) {
    instance.teardown();
    instance = null;
    bootPromise = null;
    serverUrl = null;
    console.log('[WebContainer] Torn down');
  }
}

// ─── Check if WebContainer is supported ──────────────────────
export function isSupported(): boolean {
  if (typeof window === 'undefined') return false;
  // WebContainer requires SharedArrayBuffer which needs cross-origin isolation
  return typeof SharedArrayBuffer !== 'undefined';
}
