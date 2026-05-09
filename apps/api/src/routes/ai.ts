// ============================================================
// SimpleBuild Pro — AI Routes (Phase 3: Single-Pass Streaming)
// NO tool-calling loop. ONE Anthropic call. Files streamed via
// structured XML tags. Frontend writes to WebContainer in
// real-time. 10x faster than Phase 2.
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles, aiConversations, aiMessages, usageLogs, userConnections } from '@simplebuildpro/db';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { rateLimiter } from '../middleware/rate-limiter';
import { PLAN_LIMITS, AI_MODEL, AI_MAX_TOKENS, APP_NAME } from '@simplebuildpro/shared';
import * as crypto from 'crypto';
import { logger } from '../services/logger';

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

// ─── Deploy Tools (KEPT — invoked explicitly, not in AI loop) ─
const DEPLOY_TOOLS = [
  {
    name: 'github_push',
    description: 'Push the current project files to a GitHub repository.',
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

// ─── Deploy Tool Executor (kept from Phase 2) ────────────────
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
        // Snapshot files from DB
        const dbFiles = await db.query.projectFiles.findMany({
          where: eq(projectFiles.projectId, projectId),
        });

        const { repo, branch = 'main', commit_message } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'github_repo')),
        });
        if (!connection?.accessToken) {
          return { success: false, result: null, error: 'GitHub account not connected. Connect via Settings.' };
        }

        const token = decrypt(connection.accessToken);
        if (dbFiles.length === 0) {
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
        for (const file of dbFiles) {
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

        logger.info(`[AI Tool] GitHub push: ${owner}/${repoName}#${branch} — ${dbFiles.length} files`);
        return {
          success: true,
          result: {
            status: 'success', commitSha: commitData.sha, filesCount: dbFiles.length,
            url: `https://github.com/${owner}/${repoName}/tree/${branch}`,
          },
        };
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

        const dbFiles = await db.query.projectFiles.findMany({
          where: eq(projectFiles.projectId, projectId),
        });
        if (dbFiles.length === 0) return { success: false, result: null, error: 'No files to deploy.' };

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
        for (const file of dbFiles) {
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

        logger.info(`[AI Tool] Cloudflare deploy: ${project_name} — ${dbFiles.length} files → ${deployUrl}`);
        return { success: true, result: { status: 'success', url: deployUrl, filesCount: dbFiles.length } };
      }

      case 'vercel_deploy': {
        const { project_name } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'vercel')),
        });
        if (!connection?.accessToken) return { success: false, result: null, error: 'Vercel account not connected.' };

        const vToken = decrypt(connection.accessToken);
        const dbFiles = await db.query.projectFiles.findMany({
          where: eq(projectFiles.projectId, projectId),
        });
        if (dbFiles.length === 0) return { success: false, result: null, error: 'No files to deploy.' };

        const vercelFiles = dbFiles.map(f => ({ file: f.path, data: f.content || '' }));
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
        return { success: true, result: { status: 'success', url: `https://${deployData.url}`, filesCount: dbFiles.length } };
      }

      case 'export_project': {
        const dbFiles = await db.query.projectFiles.findMany({
          where: eq(projectFiles.projectId, projectId),
        });
        const totalSize = dbFiles.reduce((sum, f) => sum + (f.content?.length || 0), 0);
        return {
          success: true,
          result: { status: 'success', filesCount: dbFiles.length, totalSizeBytes: totalSize,
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

// ─── Build System Prompt (Phase 3 — single-pass file output) ──
function buildSystemPrompt(
  fileList: { path: string; content?: string }[],
  assets: { filename: string; cdnUrl: string; mimeType: string }[],
  projectName: string,
): string {
  const fileTree = fileList
    .map(f => `  ${f.path}`)
    .join('\n') || '  (empty project)';

  const assetList = assets
    .map(a => `- ${a.filename} (${a.mimeType}) → ${a.cdnUrl}`)
    .join('\n');

  // Include existing file contents for context (truncated for large files)
  const existingFiles = fileList
    .filter(f => f.content && f.content.length > 0)
    .map(f => {
      const content = f.content!.length > 8000 ? f.content!.slice(0, 8000) + '\n... (truncated)' : f.content;
      return `### ${f.path}\n\`\`\`\n${content}\n\`\`\``;
    })
    .join('\n\n');

  return `You are the AI coding assistant for ${APP_NAME}.
You are building the project "${projectName}".

## OUTPUT FORMAT — CRITICAL
You output files using XML action tags. The frontend parses these in real-time.

To create or update a file, use this EXACT format:
<boltAction type="file" filePath="path/to/file.ext">
file content here
</boltAction>

To run a shell command (npm install, etc.), use:
<boltAction type="shell">
command here
</boltAction>

Rules:
1. Output a BRIEF explanation (1-2 sentences max) before the file blocks.
2. Output ALL files needed in a single response. Do NOT stop to ask — just build it.
3. File paths are relative to project root (e.g., "index.html", "src/app.js", "styles/main.css").
4. When modifying an existing project, output ONLY the files that need to change. Do NOT re-output unchanged files.
5. For web projects, always use Tailwind CSS via CDN unless told otherwise.
6. Write production-quality, clean, semantic HTML5.
7. NEVER wrap code in markdown code blocks (\`\`\`). Use <boltAction> tags ONLY.
8. Keep explanations MINIMAL — the user sees file changes, not your text. Maximum 2 short sentences.
9. Reference uploaded assets using their exact CDN URLs.
10. When building from scratch, include index.html as the entry point.

## CURRENT PROJECT FILES
${fileTree}

${existingFiles ? `## EXISTING FILE CONTENTS\n${existingFiles}\n` : ''}
## UPLOADED ASSETS (${assets.length})
${assetList || 'None yet.'}

## CODE QUALITY
- Use Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
- Write clean, well-structured code in any language.
- Use modern JavaScript (ES2020+), semantic HTML5, accessibility best practices.
- For React/Vue/Svelte projects, include proper package.json and build setup.`;
}

// ─── Stream Parser: Extract <boltAction> tags from streaming text ──
interface ParseState {
  buffer: string;
  insideAction: boolean;
  currentAction: { type: string; filePath?: string } | null;
  actionContent: string;
}

function createParseState(): ParseState {
  return { buffer: '', insideAction: false, currentAction: null, actionContent: '' };
}

/**
 * Process a chunk of text from the AI stream.
 * Emits events as structured actions are detected.
 * Returns text that is NOT inside action blocks (= explanation text for the user).
 */
function processChunk(
  state: ParseState,
  chunk: string,
  emit: (data: any) => void,
): string {
  state.buffer += chunk;
  let userText = '';

  while (state.buffer.length > 0) {
    if (!state.insideAction) {
      // Look for opening <boltAction tag
      const openIdx = state.buffer.indexOf('<boltAction');
      if (openIdx === -1) {
        // No tag found — check if buffer might contain a partial tag
        const partialIdx = state.buffer.lastIndexOf('<');
        if (partialIdx !== -1 && partialIdx > state.buffer.length - 60) {
          // Keep potential partial tag in buffer
          userText += state.buffer.slice(0, partialIdx);
          state.buffer = state.buffer.slice(partialIdx);
          break;
        }
        // No partial tag — all is user text
        userText += state.buffer;
        state.buffer = '';
        break;
      }

      // Text before the tag is user explanation text
      userText += state.buffer.slice(0, openIdx);
      state.buffer = state.buffer.slice(openIdx);

      // Find the end of the opening tag (>)
      const closeAngle = state.buffer.indexOf('>');
      if (closeAngle === -1) {
        // Incomplete opening tag — wait for more data
        break;
      }

      // Parse the opening tag
      const tagStr = state.buffer.slice(0, closeAngle + 1);
      state.buffer = state.buffer.slice(closeAngle + 1);

      // Extract attributes
      const typeMatch = tagStr.match(/type="([^"]+)"/);
      const filePathMatch = tagStr.match(/filePath="([^"]+)"/);

      const actionType = typeMatch?.[1] || 'file';
      const filePath = filePathMatch?.[1];

      state.currentAction = { type: actionType, filePath };
      state.actionContent = '';
      state.insideAction = true;

      // Emit file_start or shell_start
      if (actionType === 'file' && filePath) {
        emit({ type: 'file_start', path: filePath });
      } else if (actionType === 'shell') {
        emit({ type: 'shell_start' });
      }
    } else {
      // Inside an action — look for closing </boltAction>
      const closeIdx = state.buffer.indexOf('</boltAction>');
      if (closeIdx === -1) {
        // Check for partial closing tag
        const partialClose = state.buffer.lastIndexOf('</');
        if (partialClose !== -1 && partialClose > state.buffer.length - 20) {
          // Potential partial close tag — emit content up to it, keep the rest
          const content = state.buffer.slice(0, partialClose);
          state.actionContent += content;

          if (state.currentAction?.type === 'file') {
            emit({ type: 'file_content', content });
          }

          state.buffer = state.buffer.slice(partialClose);
          break;
        }

        // No close tag — emit all as content and continue waiting
        state.actionContent += state.buffer;

        if (state.currentAction?.type === 'file') {
          emit({ type: 'file_content', content: state.buffer });
        }

        state.buffer = '';
        break;
      }

      // Found close tag — emit final content + file_end
      const finalContent = state.buffer.slice(0, closeIdx);
      state.actionContent += finalContent;
      state.buffer = state.buffer.slice(closeIdx + '</boltAction>'.length);

      if (state.currentAction?.type === 'file' && state.currentAction.filePath) {
        if (finalContent) {
          emit({ type: 'file_content', content: finalContent });
        }
        emit({
          type: 'file_end',
          path: state.currentAction.filePath,
          fullContent: state.actionContent,
        });
      } else if (state.currentAction?.type === 'shell') {
        emit({
          type: 'shell_command',
          command: state.actionContent.trim(),
        });
      }

      state.insideAction = false;
      state.currentAction = null;
      state.actionContent = '';
    }
  }

  return userText;
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
  // Phase 3: mode flag — 'build' (default) or 'deploy'
  mode: z.enum(['build', 'deploy']).optional().default('build'),
});

// ─── Stream Chat (SSE) — Single-Pass Structured Output ───────
aiRoutes.post('/chat/stream', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { projectId, conversationId, message, attachments, mode } = sendMessageSchema.parse(body);

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
    attachments: attachments || [],
    tokensUsed: 0,
  });

  // Build file list with content for the system prompt
  const fileList = (project.files || []).map((f: any) => ({
    path: f.path,
    content: f.content || '',
  }));

  const systemPrompt = buildSystemPrompt(
    fileList,
    (project.assets || []).map((a: any) => ({ filename: a.filename, cdnUrl: a.cdnUrl, mimeType: a.mimeType })),
    project.name,
  );

  // Build conversation history
  const previousMessages = (conversation.messages || []).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Build the user message content (with attachments if any)
  let userContent: any = message;
  if (attachments && attachments.length > 0) {
    const parts: any[] = [];
    for (const att of attachments) {
      if (att.mimeType.startsWith('image/')) {
        parts.push({
          type: 'image',
          source: { type: 'url', url: att.url },
        });
      } else {
        // Non-image attachments: include as text reference
        parts.push({
          type: 'text',
          text: `[Attached file: ${att.filename} (${att.mimeType}) — ${att.url}]`,
        });
      }
    }
    parts.push({ type: 'text', text: message });
    userContent = parts;
  }

  const apiMessages = [...previousMessages, { role: 'user' as const, content: userContent }];
  const convId = conversation.id;

  // ─── DEPLOY MODE: use tool-calling for deploy operations only ──
  if (mode === 'deploy') {
    // Deploy mode: single Anthropic call with deploy tools
    const deploySystemPrompt = `You are the deployment assistant for ${APP_NAME}.
The user wants to deploy or ship their project "${project.name}".
Use the available tools to help them deploy.`;

    const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getAnthropicKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 2048,
        system: deploySystemPrompt,
        messages: [{ role: 'user', content: message }],
        tools: DEPLOY_TOOLS,
      }),
    });

    if (!anthropicResponse.ok) {
      throw new AppError(502, 'AI_ERROR', 'AI service returned an error.');
    }

    const anthropicData = await anthropicResponse.json() as any;
    const toolUseBlocks = anthropicData.content?.filter((b: any) => b.type === 'tool_use') || [];
    const textBlocks = anthropicData.content?.filter((b: any) => b.type === 'text') || [];
    const replyText = textBlocks.map((b: any) => b.text).join('');

    let deployResult = null;
    for (const block of toolUseBlocks) {
      deployResult = await executeDeployTool(block.name, block.input, session.userId, projectId);
    }

    return c.json({
      success: true,
      data: {
        conversationId: convId,
        text: replyText,
        deployResult,
      },
    });
  }

  // ─── BUILD MODE: Single-pass structured output streaming ───
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { /* controller closed */ }
      };

      logger.info(`[AI Stream Phase3] Starting — conv=${convId}, project=${projectId}, files=${fileList.length}`);

      emit({
        type: 'stream_start',
        conversationId: convId,
      });

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      const filesWritten: string[] = [];

      try {
        // ONE call to Anthropic — no tools, just text generation
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
            messages: apiMessages,
            // NO tools — pure text generation with structured output
          }),
        });

        if (!anthropicResponse.ok || !anthropicResponse.body) {
          const errText = await anthropicResponse.text().catch(() => '');
          logger.error('[AI Stream Phase3] Anthropic error:', anthropicResponse.status, errText);
          emit({ type: 'error', message: `AI service error (${anthropicResponse.status}): ${errText.slice(0, 200)}` });
          controller.close();
          return;
        }

        // Parse the Anthropic SSE stream
        const reader = anthropicResponse.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        const parseState = createParseState();

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

              if (evt.type === 'message_delta' && evt.usage) {
                totalOutputTokens += evt.usage.output_tokens || 0;
              }

              if (evt.type === 'content_block_delta' && evt.delta?.text) {
                const rawToken = evt.delta.text;

                // Process through the structured output parser
                const userText = processChunk(parseState, rawToken, (actionEvent) => {
                  // Handle parsed action events
                  switch (actionEvent.type) {
                    case 'file_start':
                      emit({ type: 'file_start', path: actionEvent.path });
                      break;

                    case 'file_content':
                      emit({ type: 'file_content', content: actionEvent.content });
                      break;

                    case 'file_end':
                      filesWritten.push(actionEvent.path);
                      emit({
                        type: 'file_end',
                        path: actionEvent.path,
                      });

                      // Persist file to database (fire and forget — don't block stream)
                      const filePath = actionEvent.path;
                      const fileContent = actionEvent.fullContent;
                      (async () => {
                        try {
                          const existing = await db.query.projectFiles.findFirst({
                            where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, filePath)),
                          });
                          const contentHash = crypto.createHash('sha256').update(fileContent).digest('hex');
                          const sizeBytes = Buffer.byteLength(fileContent, 'utf-8');
                          if (existing) {
                            await db.update(projectFiles).set({
                              content: fileContent, contentHash, sizeBytes, updatedAt: new Date(),
                            }).where(eq(projectFiles.id, existing.id));
                          } else {
                            await db.insert(projectFiles).values({
                              projectId, path: filePath, content: fileContent,
                              contentHash, mimeType: 'text/plain', sizeBytes,
                            });
                          }
                        } catch (dbErr: any) {
                          logger.error(`[AI Stream Phase3] DB persist failed for ${filePath}: ${dbErr.message}`);
                        }
                      })();
                      break;

                    case 'shell_start':
                      emit({ type: 'shell_start' });
                      break;

                    case 'shell_command':
                      emit({ type: 'shell_command', command: actionEvent.command });
                      break;
                  }
                });

                // Emit user-facing text tokens (the brief explanation, not file contents)
                if (userText) {
                  emit({ type: 'text', token: userText });
                }
              }
            } catch { /* skip malformed SSE data */ }
          }
        }

        // Flush any remaining buffer in the parser
        if (parseState.buffer) {
          const remaining = processChunk(parseState, '', (actionEvent) => {
            if (actionEvent.type === 'file_end') {
              filesWritten.push(actionEvent.path);
              emit({ type: 'file_end', path: actionEvent.path });
            }
          });
          if (remaining) {
            emit({ type: 'text', token: remaining });
          }
        }

        const tokensUsed = totalInputTokens + totalOutputTokens;

        // Save assistant message to DB (just the explanation text, not file contents)
        const fullText = ''; // We streamed text tokens directly; reconstruct isn't needed for DB
        await db.insert(aiMessages).values({
          conversationId: convId,
          role: 'assistant',
          content: `[Generated ${filesWritten.length} file(s): ${filesWritten.join(', ')}]`,
          attachments: [],
          tokensUsed,
          appliedFiles: filesWritten.length > 0,
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

        logger.info(`[AI Stream Phase3] Done — conv=${convId}, tokens=${tokensUsed}, files=${filesWritten.length}`);

        emit({
          type: 'stream_end',
          conversationId: convId,
          filesChanged: filesWritten,
          tokensUsed,
        });

      } catch (err: any) {
        logger.error('[AI Stream Phase3] Error:', err);
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
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

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

  const fileList = (project.files || []).map((f: any) => ({ path: f.path, content: f.content || '' }));
  const systemPrompt = buildSystemPrompt(
    fileList,
    (project.assets || []).map((a: any) => ({ filename: a.filename, cdnUrl: a.cdnUrl, mimeType: a.mimeType })),
    project.name,
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
