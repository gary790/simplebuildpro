// ============================================================
// SimpleBuild Pro — AI Routes (Phase 2: Sandbox Architecture)
// Anthropic Claude with tool_use against E2B sandboxes
// No more XML protocol — AI calls real tools (run_command,
// write_file, read_file, list_files) against Linux containers
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles, aiConversations, aiMessages, usageLogs, userConnections, projectIntegrations } from '@simplebuildpro/db';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { rateLimiter } from '../middleware/rate-limiter';
import { PLAN_LIMITS, AI_MODEL, AI_MAX_TOKENS, APP_NAME } from '@simplebuildpro/shared';
import * as crypto from 'crypto';
import { logger } from '../services/logger';
import * as sandboxService from '../services/sandbox';

export const aiRoutes = new Hono<AuthEnv>();
aiRoutes.use('*', requireAuth);
aiRoutes.use('*', rateLimiter('ai'));

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AppError(500, 'AI_NOT_CONFIGURED', 'AI service is not configured. Set ANTHROPIC_API_KEY.');
  return key;
}

// ─── Encryption helpers (mirrors integrations.ts) ────────────
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function decrypt(encryptedText: string): string {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    if (!ivHex || !authTagHex || !encrypted) return encryptedText;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return encryptedText;
  }
}

// ─── Sandbox Tools (NEW — interact with E2B sandbox) ────────
const SANDBOX_TOOLS = [
  {
    name: 'run_command',
    description: 'Run a bash command in the project sandbox. Use for:\n- grep/find to search files\n- sed to edit files in place\n- cat to read file contents\n- rm to delete files or directories\n- mkdir to create directories\n- npm install to add packages\n- Any other shell command\nWorking directory is /home/user/project/.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file in the project sandbox. Use for creating new files or fully rewriting existing ones. For small edits to existing files, prefer run_command with sed instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to project root (e.g., "index.html", "src/app.js")' },
        content: { type: 'string', description: 'Complete file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file from the project sandbox. Use before editing to understand current state.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path relative to project root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories in the project sandbox. Gives awareness of project structure.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Directory path relative to project root (default: ".")' },
      },
      required: [],
    },
  },
];

// ─── Deploy/Ship Tools (KEPT from old architecture) ─────────
const DEPLOY_TOOLS = [
  {
    name: 'github_push',
    description: 'Push the current project files to a GitHub repository. The user must have a connected GitHub account.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'GitHub repository in "owner/repo" format.' },
        branch: { type: 'string', description: 'Branch to push to. Defaults to "main".' },
        commit_message: { type: 'string', description: 'Commit message.' },
      },
      required: ['repo', 'commit_message'],
    },
  },
  {
    name: 'cloudflare_deploy',
    description: 'Deploy the current project to Cloudflare Pages.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: { type: 'string', description: 'Cloudflare Pages project name.' },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'vercel_deploy',
    description: 'Deploy the current project to Vercel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: { type: 'string', description: 'Vercel project name.' },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'export_project',
    description: 'Export the current project files as a downloadable package.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_connections',
    description: 'List the user\'s connected accounts (GitHub, Cloudflare, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// All tools available to the AI
const ALL_TOOLS = [...SANDBOX_TOOLS, ...DEPLOY_TOOLS];

// ─── Sandbox Tool Executor ──────────────────────────────────
async function executeSandboxTool(
  toolName: string,
  toolInput: Record<string, any>,
  projectId: string,
): Promise<{ success: boolean; result: any; error?: string; filesChanged?: string[] }> {
  try {
    switch (toolName) {
      case 'run_command': {
        const { command } = toolInput;
        const result = await sandboxService.execCommand(projectId, command);
        // Detect file changes from certain commands
        const filesChanged: string[] = [];
        const cmd = command.trim().toLowerCase();
        if (cmd.startsWith('sed ') || cmd.startsWith('rm ') || cmd.startsWith('mv ') ||
            cmd.startsWith('cp ') || cmd.startsWith('touch ') || cmd.includes('>') ||
            cmd.startsWith('mkdir ')) {
          filesChanged.push('*'); // Signal that files may have changed
        }
        return {
          success: result.exitCode === 0,
          result: {
            stdout: result.stdout.slice(0, 10000), // Truncate large outputs
            stderr: result.stderr.slice(0, 5000),
            exitCode: result.exitCode,
          },
          error: result.exitCode !== 0 ? result.stderr.slice(0, 500) : undefined,
          filesChanged,
        };
      }

      case 'write_file': {
        const { path, content } = toolInput;
        await sandboxService.writeFile(projectId, path, content);
        return {
          success: true,
          result: { path, size: content.length, message: `File written: ${path}` },
          filesChanged: [path],
        };
      }

      case 'read_file': {
        const { path } = toolInput;
        const content = await sandboxService.readFile(projectId, path);
        return {
          success: true,
          result: { path, content: content.slice(0, 50000), size: content.length },
        };
      }

      case 'list_files': {
        const { path = '.' } = toolInput;
        const files = await sandboxService.listFiles(projectId, path);
        return {
          success: true,
          result: { path, files: files.slice(0, 200) },
        };
      }

      default:
        return { success: false, result: null, error: `Unknown sandbox tool: ${toolName}` };
    }
  } catch (err: any) {
    logger.error(`[AI Tool] ${toolName} failed: ${err.message}`);
    return { success: false, result: null, error: err.message };
  }
}

// ─── Deploy Tool Executor (kept from old architecture) ──────
async function executeDeployTool(
  toolName: string,
  toolInput: Record<string, any>,
  userId: string,
  projectId: string,
): Promise<{ success: boolean; result: any; error?: string }> {
  const db = getDb();

  try {
    switch (toolName) {
      case 'list_connections': {
        const connections = await db.query.userConnections.findMany({
          where: eq(userConnections.userId, userId),
        });
        return {
          success: true,
          result: {
            connections: connections.map(c => ({
              provider: c.provider,
              displayName: c.displayName,
              accountId: c.accountId,
              connected: true,
            })),
          },
        };
      }

      case 'github_push': {
        // First, snapshot files from sandbox to DB so we have the latest
        const snapshotFiles = await sandboxService.snapshotFiles(projectId).catch(() => []);
        if (snapshotFiles.length > 0) {
          for (const file of snapshotFiles) {
            const existing = await db.query.projectFiles.findFirst({
              where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, file.path)),
            });
            const contentHash = crypto.createHash('sha256').update(file.content).digest('hex');
            const sizeBytes = Buffer.byteLength(file.content, 'utf-8');

            if (existing) {
              await db.update(projectFiles).set({
                content: file.content, contentHash, sizeBytes, updatedAt: new Date(),
              }).where(eq(projectFiles.id, existing.id));
            } else {
              await db.insert(projectFiles).values({
                projectId, path: file.path, content: file.content,
                contentHash, mimeType: 'text/plain', sizeBytes,
              });
            }
          }
        }

        const { repo, branch = 'main', commit_message } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'github_repo')),
        });
        if (!connection?.accessToken) {
          return { success: false, result: null, error: 'GitHub account not connected. Connect via Settings.' };
        }

        const token = decrypt(connection.accessToken);
        const files = await db.query.projectFiles.findMany({
          where: eq(projectFiles.projectId, projectId),
        });
        if (files.length === 0) {
          return { success: false, result: null, error: 'No files to push.' };
        }

        const [owner, repoName] = repo.includes('/') ? repo.split('/') : [connection.displayName, repo];
        const apiBase = `https://api.github.com/repos/${owner}/${repoName}`;
        const headers = {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'SimpleBuildPro',
        };

        let baseSha: string | null = null;
        let baseTreeSha: string | null = null;
        try {
          const refRes = await fetch(`${apiBase}/git/ref/heads/${branch}`, { headers });
          if (refRes.ok) {
            const refData = await refRes.json() as any;
            baseSha = refData.object.sha;
            const commitRes = await fetch(`${apiBase}/git/commits/${baseSha}`, { headers });
            const commitData = await commitRes.json() as any;
            baseTreeSha = commitData.tree.sha;
          }
        } catch { /* Branch doesn't exist */ }

        const treeItems: any[] = [];
        for (const file of files) {
          const blobRes = await fetch(`${apiBase}/git/blobs`, {
            method: 'POST', headers,
            body: JSON.stringify({ content: file.content || '', encoding: 'utf-8' }),
          });
          if (!blobRes.ok) throw new Error(`Blob failed for ${file.path}`);
          const blobData = await blobRes.json() as any;
          treeItems.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha });
        }

        const treePayload: any = { tree: treeItems };
        if (baseTreeSha) treePayload.base_tree = baseTreeSha;
        const treeRes = await fetch(`${apiBase}/git/trees`, {
          method: 'POST', headers, body: JSON.stringify(treePayload),
        });
        if (!treeRes.ok) throw new Error('Tree creation failed');
        const treeData = await treeRes.json() as any;

        const commitPayload: any = { message: commit_message, tree: treeData.sha };
        if (baseSha) commitPayload.parents = [baseSha];
        const commitRes = await fetch(`${apiBase}/git/commits`, {
          method: 'POST', headers, body: JSON.stringify(commitPayload),
        });
        if (!commitRes.ok) throw new Error('Commit creation failed');
        const commitData = await commitRes.json() as any;

        if (baseSha) {
          await fetch(`${apiBase}/git/refs/heads/${branch}`, {
            method: 'PATCH', headers, body: JSON.stringify({ sha: commitData.sha, force: true }),
          });
        } else {
          await fetch(`${apiBase}/git/refs`, {
            method: 'POST', headers, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitData.sha }),
          });
        }

        const actionResult = {
          status: 'success', commitSha: commitData.sha, filesCount: files.length,
          url: `https://github.com/${owner}/${repoName}/tree/${branch}`,
        };
        logger.info(`[AI Tool] GitHub push: ${owner}/${repoName}#${branch} — ${files.length} files`);
        return { success: true, result: actionResult };
      }

      case 'cloudflare_deploy': {
        const { project_name } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'cloudflare')),
        });
        if (!connection?.accessToken) {
          return { success: false, result: null, error: 'Cloudflare account not connected.' };
        }

        const cfToken = decrypt(connection.accessToken);
        const accountId = connection.accountId;
        if (!accountId) return { success: false, result: null, error: 'Cloudflare account ID not found.' };

        // Snapshot latest files from sandbox
        const sbFiles = await sandboxService.snapshotFiles(projectId).catch(() => []);
        if (sbFiles.length === 0) return { success: false, result: null, error: 'No files to deploy.' };

        const cfHeaders = { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' };

        const checkRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project_name}`, { headers: cfHeaders });
        if (!checkRes.ok) {
          const createRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
            method: 'POST', headers: cfHeaders, body: JSON.stringify({ name: project_name, production_branch: 'main' }),
          });
          if (!createRes.ok) {
            const err = await createRes.json() as any;
            throw new Error(`Create project failed: ${JSON.stringify(err.errors)}`);
          }
        }

        const formData = new FormData();
        for (const file of sbFiles) {
          formData.append(file.path, new Blob([file.content || '']), file.path);
        }
        const deployRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project_name}/deployments`,
          { method: 'POST', headers: { Authorization: `Bearer ${cfToken}` }, body: formData },
        );
        if (!deployRes.ok) {
          const err = await deployRes.json() as any;
          throw new Error(`Deploy failed: ${JSON.stringify(err.errors)}`);
        }
        const deployData = await deployRes.json() as any;
        const deployUrl = deployData.result?.url || `https://${project_name}.pages.dev`;

        logger.info(`[AI Tool] Cloudflare deploy: ${project_name} — ${sbFiles.length} files → ${deployUrl}`);
        return { success: true, result: { status: 'success', url: deployUrl, filesCount: sbFiles.length } };
      }

      case 'vercel_deploy': {
        const { project_name } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'vercel')),
        });
        if (!connection?.accessToken) return { success: false, result: null, error: 'Vercel account not connected.' };

        const vToken = decrypt(connection.accessToken);
        const sbFiles = await sandboxService.snapshotFiles(projectId).catch(() => []);
        if (sbFiles.length === 0) return { success: false, result: null, error: 'No files to deploy.' };

        const vercelFiles = sbFiles.map(f => ({ file: f.path, data: f.content || '' }));
        const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
          method: 'POST',
          headers: { Authorization: `Bearer ${vToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: project_name, files: vercelFiles, projectSettings: { framework: null }, target: 'production' }),
        });
        if (!deployRes.ok) {
          const err = await deployRes.json() as any;
          throw new Error(`Vercel deploy failed: ${err.error?.message || JSON.stringify(err)}`);
        }
        const deployData = await deployRes.json() as any;
        const deployUrl = `https://${deployData.url}`;
        return { success: true, result: { status: 'success', url: deployUrl, filesCount: sbFiles.length } };
      }

      case 'export_project': {
        const sbFiles = await sandboxService.snapshotFiles(projectId).catch(() => []);
        const totalSize = sbFiles.reduce((sum, f) => sum + (f.content?.length || 0), 0);
        return {
          success: true,
          result: { status: 'success', filesCount: sbFiles.length, totalSizeBytes: totalSize,
            message: 'Project export ready. Download from the Ship panel.' },
        };
      }

      default:
        return { success: false, result: null, error: `Unknown tool: ${toolName}` };
    }
  } catch (err: any) {
    logger.error(`[AI Tool] ${toolName} failed: ${err.message}`);
    return { success: false, result: null, error: err.message };
  }
}

// ─── Build System Prompt (NEW — sandbox-aware) ──────────────
function buildSystemPrompt(
  fileList: { path: string; isDir: boolean }[],
  assets: { filename: string; cdnUrl: string; mimeType: string }[],
  projectName: string,
  previewUrl: string | null,
): string {
  const fileTree = fileList
    .filter(f => !f.isDir)
    .map(f => `  ${f.path}`)
    .join('\n') || '  (empty project)';

  const assetList = assets
    .map(a => `- ${a.filename} (${a.mimeType}) → ${a.cdnUrl}`)
    .join('\n');

  return `You are the AI coding assistant for ${APP_NAME} Studio.
You have FULL ACCESS to the user's project "${projectName}" as a real Linux filesystem.

## TOOLS AVAILABLE
You have tools to interact with the project sandbox:
- **run_command**: Run any bash command (grep, sed, cat, rm, mkdir, npm, etc.)
- **write_file**: Create or overwrite a file (use for new files or full rewrites)
- **read_file**: Read a file's contents
- **list_files**: List directory contents

And deployment tools:
- **github_push**: Push to GitHub
- **cloudflare_deploy**: Deploy to Cloudflare Pages
- **vercel_deploy**: Deploy to Vercel
- **export_project**: Export for download
- **list_connections**: Check connected services

## CURRENT PROJECT FILES
${fileTree}

${previewUrl ? `## LIVE PREVIEW\nA dev server is running at: ${previewUrl}\nChanges to files are reflected when the user refreshes the preview.\n` : ''}
## UPLOADED ASSETS (${assets.length})
${assetList || 'None yet.'}
When referencing assets in code, use their CDN URLs directly.

## WORKFLOW RULES
1. **ALWAYS read before editing** — use read_file or run_command with cat/grep to understand what exists before making changes.
2. **Prefer surgical edits** — use run_command with sed for small changes instead of rewriting entire files.
3. **Use write_file for new files** — or when you need to completely rewrite a file.
4. **Delete with rm** — use run_command with rm to delete files when asked.
5. **Test your changes** — after modifying code, use cat or read_file to verify the changes look correct.
6. **Explain what you did** — after making changes, briefly describe what was changed and why.

## CODE QUALITY
- For web projects, index.html is the entry point.
- Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) unless the user specifies otherwise.
- Write production-quality, semantic HTML5 with accessibility.
- Write clean, well-structured code in any language.
- Reference uploaded assets using their exact CDN URLs.`;
}

// ─── Send Message Schema ─────────────────────────────────────
const sendMessageSchema = z.object({
  projectId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(32000),
  attachments: z.array(z.object({
    filename: z.string(),
    mimeType: z.string(),
    url: z.string(),
  })).optional().default([]),
});

// ─── Stream Chat (SSE) — Tool-Calling Loop ──────────────────
aiRoutes.post('/chat/stream', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { projectId, conversationId, message } = sendMessageSchema.parse(body);

  const db = getDb();

  // Verify project ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
    with: { files: true, assets: true },
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  // Check AI usage limits
  const limits = PLAN_LIMITS[session.plan as keyof typeof PLAN_LIMITS] || PLAN_LIMITS.free;
  if (limits.aiMessagesPerMonth !== -1) {
    const [{ count: usageCount }] = await db.select({ count: count() })
      .from(aiMessages)
      .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
      .where(and(
        eq(aiConversations.userId, session.userId),
        eq(aiMessages.role, 'user'),
      ));
    if (usageCount >= limits.aiMessagesPerMonth) {
      throw new AppError(403, 'AI_LIMIT_REACHED',
        `Your ${session.plan} plan allows ${limits.aiMessagesPerMonth} AI messages per month. Upgrade for more.`);
    }
  }

  // Get or create conversation
  let conversation: any;
  if (conversationId) {
    conversation = await db.query.aiConversations.findFirst({
      where: and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.projectId, projectId),
        eq(aiConversations.userId, session.userId),
      ),
      with: { messages: { orderBy: aiMessages.createdAt, limit: 50 } },
    });
    if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  } else {
    [conversation] = await db.insert(aiConversations).values({
      projectId,
      userId: session.userId,
    }).returning();
    conversation.messages = [];
  }

  // Save user message to DB immediately
  await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: 'user',
    content: message,
    attachments: [],
    tokensUsed: 0,
  });

  // Ensure sandbox is running for this project
  let sandboxInfo: any = null;
  let previewUrl: string | null = null;
  try {
    sandboxInfo = await sandboxService.getOrCreateSandbox(projectId);
    previewUrl = sandboxInfo.previewUrl;

    // If sandbox just created and project has DB files, restore them
    const sbFiles = await sandboxService.listFiles(projectId, '.').catch(() => []);
    const hasProjectFiles = sbFiles.some(f => !f.isDir && f.path !== 'package.json' && f.path !== 'package-lock.json');
    if (!hasProjectFiles && project.files && project.files.length > 0) {
      await sandboxService.restoreFilesFromDB(projectId, project.files.map((f: any) => ({
        path: f.path, content: f.content || '',
      })));
    }

    // Start dev server if not already running
    previewUrl = await sandboxService.startDevServer(projectId).catch(() => previewUrl);
  } catch (err: any) {
    logger.error(`[AI Stream] Sandbox init failed: ${err.message}`);
    // Continue without sandbox — the AI tools will just fail gracefully
  }

  // Get file listing from sandbox for context
  let fileList: { path: string; isDir: boolean }[] = [];
  try {
    fileList = await sandboxService.listFiles(projectId, '.');
  } catch {
    // Fallback to DB files
    fileList = (project.files || []).map((f: any) => ({ path: f.path, isDir: false }));
  }

  const systemPrompt = buildSystemPrompt(
    fileList,
    (project.assets || []).map((a: any) => ({ filename: a.filename, cdnUrl: a.cdnUrl, mimeType: a.mimeType })),
    project.name,
    previewUrl,
  );

  // Get conversation history
  const previousMessages = (conversation.messages || []).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const apiMessages = [...previousMessages, { role: 'user' as const, content: message }];
  const convId = conversation.id;

  // Create SSE stream
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* controller closed */ }
      };

      console.log(`[AI Stream] Starting — conv=${convId}, project=${projectId}, sandbox=${sandboxInfo?.sandboxId || 'none'}`);

      emit({
        type: 'stream_start',
        conversationId: convId,
        sandboxUrl: previewUrl,
      });

      let fullTextContent = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let allFilesChanged: string[] = [];
      let maxToolRounds = 10; // Allow more rounds for complex tasks
      let currentMessages = [...apiMessages];

      try {
        while (maxToolRounds > 0) {
          console.log(`[AI Stream] Calling Anthropic — round=${11 - maxToolRounds}, msgCount=${currentMessages.length}`);

          // Make streaming request to Anthropic
          const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': getAnthropicKey(),
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: AI_MODEL,
              max_tokens: AI_MAX_TOKENS,
              stream: true,
              system: systemPrompt,
              messages: currentMessages,
              tools: ALL_TOOLS,
            }),
          });

          if (!anthropicResponse.ok || !anthropicResponse.body) {
            const errText = await anthropicResponse.text().catch(() => '');
            console.error('[AI Stream] Anthropic error:', anthropicResponse.status, errText);
            emit({ type: 'error', message: `AI service error (${anthropicResponse.status}): ${errText.slice(0, 200)}` });
            break;
          }

          // Parse the stream
          const reader = anthropicResponse.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = '';
          let stopReason = '';
          let streamTextContent = '';
          let contentBlocks: any[] = [];
          let currentBlockType = '';
          let toolUseId = '';
          let toolUseName = '';
          let toolInputJson = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;

              try {
                const evt = JSON.parse(data);

                if (evt.type === 'message_start' && evt.message?.usage) {
                  totalInputTokens += evt.message.usage.input_tokens || 0;
                }

                if (evt.type === 'message_delta') {
                  if (evt.usage) totalOutputTokens += evt.usage.output_tokens || 0;
                  if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
                }

                if (evt.type === 'content_block_start') {
                  if (evt.content_block?.type === 'text') {
                    currentBlockType = 'text';
                  } else if (evt.content_block?.type === 'tool_use') {
                    currentBlockType = 'tool_use';
                    toolUseId = evt.content_block.id || '';
                    toolUseName = evt.content_block.name || '';
                    toolInputJson = '';
                  }
                }

                if (evt.type === 'content_block_delta') {
                  if (currentBlockType === 'text' && evt.delta?.text) {
                    const token = evt.delta.text;
                    streamTextContent += token;
                    // Stream text tokens to frontend immediately
                    emit({ type: 'text', token });
                  } else if (currentBlockType === 'tool_use' && evt.delta?.partial_json) {
                    toolInputJson += evt.delta.partial_json;
                  }
                }

                if (evt.type === 'content_block_stop') {
                  if (currentBlockType === 'text') {
                    contentBlocks.push({ type: 'text', text: streamTextContent });
                  } else if (currentBlockType === 'tool_use') {
                    let parsedInput = {};
                    try { parsedInput = JSON.parse(toolInputJson); } catch {}
                    contentBlocks.push({ type: 'tool_use', id: toolUseId, name: toolUseName, input: parsedInput });
                  }
                  currentBlockType = '';
                }
              } catch { /* skip malformed SSE data */ }
            }
          }

          fullTextContent += streamTextContent;

          // Check if we stopped for tool_use
          if (stopReason === 'tool_use') {
            const toolUseBlocks = contentBlocks.filter(b => b.type === 'tool_use');
            if (toolUseBlocks.length === 0) break;

            // Execute each tool and send events to frontend
            const toolResults: any[] = [];
            for (const toolBlock of toolUseBlocks) {
              const isSandboxTool = SANDBOX_TOOLS.some(t => t.name === toolBlock.name);

              // Emit tool_call event to frontend
              emit({
                type: 'tool_call',
                tool: toolBlock.name,
                input: toolBlock.name === 'write_file'
                  ? { path: toolBlock.input.path, contentLength: toolBlock.input.content?.length || 0 }
                  : toolBlock.input,
              });

              // Execute the tool
              let toolResult: any;
              if (isSandboxTool) {
                toolResult = await executeSandboxTool(toolBlock.name, toolBlock.input, projectId);
              } else {
                toolResult = await executeDeployTool(toolBlock.name, toolBlock.input, session.userId, projectId);
              }

              // Emit tool_result event to frontend
              emit({
                type: 'tool_result',
                tool: toolBlock.name,
                success: toolResult.success,
                output: typeof toolResult.result === 'string'
                  ? toolResult.result.slice(0, 2000)
                  : JSON.stringify(toolResult.result)?.slice(0, 2000),
                exitCode: toolResult.result?.exitCode,
                error: toolResult.error,
              });

              // Track file changes
              if (toolResult.filesChanged) {
                for (const f of toolResult.filesChanged) {
                  if (!allFilesChanged.includes(f)) {
                    allFilesChanged.push(f);
                    emit({ type: 'file_changed', path: f, action: toolBlock.name === 'write_file' ? 'create' : 'edit' });
                  }
                }
              }

              // Build tool_result message for Anthropic
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: toolResult.success
                  ? JSON.stringify(toolResult.result)
                  : JSON.stringify({ error: toolResult.error }),
                is_error: !toolResult.success,
              });
            }

            // Continue conversation with tool results
            currentMessages = [
              ...currentMessages,
              { role: 'assistant' as const, content: contentBlocks as any },
              { role: 'user' as const, content: toolResults as any },
            ];

            // Reset for next round
            maxToolRounds--;
            continue;
          }

          // No tool use — stream is complete
          break;
        }

        const tokensUsed = totalInputTokens + totalOutputTokens;

        // Save assistant message to DB
        await db.insert(aiMessages).values({
          conversationId: convId,
          role: 'assistant',
          content: fullTextContent,
          attachments: [],
          tokensUsed,
          appliedFiles: allFilesChanged.length > 0,
        });

        // Update conversation stats
        await db.update(aiConversations).set({
          messageCount: (conversation.messageCount || 0) + 2,
          totalTokensUsed: (conversation.totalTokensUsed || 0) + tokensUsed,
          updatedAt: new Date(),
        }).where(eq(aiConversations.id, convId));

        // Log usage
        await db.insert(usageLogs).values({
          userId: session.userId,
          organizationId: session.organizationId,
          type: 'ai_tokens',
          quantity: tokensUsed,
          metadata: { conversationId: convId, model: AI_MODEL },
        });

        console.log(`[AI Stream] Done — conv=${convId}, tokens=${tokensUsed}, filesChanged=${allFilesChanged.length}`);

        emit({
          type: 'stream_end',
          conversationId: convId,
          filesChanged: allFilesChanged,
          tokensUsed,
        });

      } catch (err: any) {
        console.error('[AI Stream] Error:', err);
        emit({ type: 'error', message: err.message || 'Stream error' });
      } finally {
        controller.close();
      }
    },
  });

  // Must include CORS headers — raw Response bypasses Hono's cors() middleware
  const origin = c.req.header('Origin') || '';
  const allowedOrigins = [
    'https://simplebuildpro.com',
    'https://www.simplebuildpro.com',
    'https://app.simplebuildpro.com',
    'http://localhost:3000',
    'http://localhost:3001',
  ];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[2];

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Conversation-Id': convId,
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'X-Conversation-Id',
    },
  });
});

// ─── Non-Streaming Chat (fallback) ──────────────────────────
aiRoutes.post('/chat', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { projectId, conversationId, message } = sendMessageSchema.parse(body);

  const db = getDb();

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
    with: { files: true, assets: true },
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  // Get or create conversation
  let conversation: any;
  if (conversationId) {
    conversation = await db.query.aiConversations.findFirst({
      where: and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.projectId, projectId),
        eq(aiConversations.userId, session.userId),
      ),
      with: { messages: { orderBy: aiMessages.createdAt, limit: 50 } },
    });
    if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  } else {
    [conversation] = await db.insert(aiConversations).values({
      projectId,
      userId: session.userId,
    }).returning();
    conversation.messages = [];
  }

  await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: 'user',
    content: message,
    attachments: [],
    tokensUsed: 0,
  });

  // Simple non-streaming response (for fallback)
  const fileList = (project.files || []).map((f: any) => ({ path: f.path, isDir: false }));
  const systemPrompt = buildSystemPrompt(
    fileList,
    (project.assets || []).map((a: any) => ({ filename: a.filename, cdnUrl: a.cdnUrl, mimeType: a.mimeType })),
    project.name,
    null,
  );

  const previousMessages = (conversation.messages || []).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
  const apiMessages2 = [...previousMessages, { role: 'user' as const, content: message }];

  const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getAnthropicKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: AI_MAX_TOKENS,
      system: systemPrompt,
      messages: apiMessages2,
      tools: ALL_TOOLS,
    }),
  });

  if (!anthropicResponse.ok) {
    throw new AppError(502, 'AI_ERROR', 'AI service returned an error.');
  }

  const anthropicData = await anthropicResponse.json() as any;
  const textBlocks = anthropicData.content?.filter((b: any) => b.type === 'text') || [];
  const replyText = textBlocks.map((b: any) => b.text).join('');
  const tokensUsed = (anthropicData.usage?.input_tokens || 0) + (anthropicData.usage?.output_tokens || 0);

  const [assistantMsg] = await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: 'assistant',
    content: replyText,
    attachments: [],
    tokensUsed,
    appliedFiles: false,
  }).returning();

  return c.json({
    success: true,
    data: {
      conversationId: conversation.id,
      message: {
        id: assistantMsg.id,
        role: 'assistant',
        content: replyText,
        tokensUsed,
        createdAt: assistantMsg.createdAt.toISOString(),
      },
    },
  });
});

// ─── Get Conversation History ────────────────────────────────
aiRoutes.get('/conversations/:projectId', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const db = getDb();

  const conversations = await db.query.aiConversations.findMany({
    where: and(
      eq(aiConversations.projectId, projectId),
      eq(aiConversations.userId, session.userId),
    ),
    orderBy: desc(aiConversations.updatedAt),
    limit: 20,
  });

  return c.json({
    success: true,
    data: conversations.map(conv => ({
      id: conv.id,
      messageCount: conv.messageCount,
      totalTokensUsed: conv.totalTokensUsed,
      createdAt: conv.createdAt.toISOString(),
      updatedAt: conv.updatedAt.toISOString(),
    })),
  });
});

// ─── Get Messages for Conversation ───────────────────────────
aiRoutes.get('/conversations/:projectId/:conversationId', async (c) => {
  const session = c.get('session');
  const projectId = c.req.param('projectId');
  const conversationId = c.req.param('conversationId');
  const db = getDb();

  const conversation = await db.query.aiConversations.findFirst({
    where: and(
      eq(aiConversations.id, conversationId),
      eq(aiConversations.projectId, projectId),
      eq(aiConversations.userId, session.userId),
    ),
    with: { messages: { orderBy: aiMessages.createdAt } },
  });

  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');

  return c.json({
    success: true,
    data: {
      id: conversation.id,
      messages: conversation.messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        attachments: m.attachments,
        tokensUsed: m.tokensUsed,
        appliedFiles: m.appliedFiles,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  });
});
