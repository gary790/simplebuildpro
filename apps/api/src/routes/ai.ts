// ============================================================
// SimpleBuild Pro — AI Routes
// Real Anthropic Claude API proxy — NEVER exposes keys to client
// Streaming support for real-time token delivery
// ============================================================

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '@simplebuildpro/db';
import { projects, projectFiles, aiConversations, aiMessages, usageLogs } from '@simplebuildpro/db';
import { eq, and, desc, count } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { rateLimiter } from '../middleware/rate-limiter';
import { PLAN_LIMITS, AI_MODEL, AI_MAX_TOKENS, APP_NAME } from '@simplebuildpro/shared';

export const aiRoutes = new Hono<AuthEnv>();
aiRoutes.use('*', requireAuth);
aiRoutes.use('*', rateLimiter('ai'));

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AppError(500, 'AI_NOT_CONFIGURED', 'AI service is not configured. Set ANTHROPIC_API_KEY.');
  return key;
}

// ─── Build System Prompt with Full Project Context ───────────
function buildSystemPrompt(
  projectFiles: { path: string; content: string }[],
  assets: { filename: string; cdnUrl: string; mimeType: string }[],
  projectName: string,
): string {
  const fileCtx = projectFiles
    .map(f => `=== ${f.path} ===\n${f.content}`)
    .join('\n\n');

  const assetList = assets
    .map(a => `- ${a.filename} (${a.mimeType}) → ${a.cdnUrl}`)
    .join('\n');

  return `You are the AI coding assistant for ${APP_NAME}, an enterprise website builder platform.
You have FULL CONTEXT of the user's project "${projectName}" — all source files and uploaded assets.

## PROJECT FILES
${fileCtx || 'No files yet. Create index.html as the entry point.'}

## UPLOADED ASSETS (${assets.length} files)
${assetList || 'None yet.'}
When referencing assets in code, use their CDN URLs directly in src attributes.

## CRITICAL OUTPUT FORMAT
When you create or modify code, you MUST output ALL changed/new files inside a single fenced JSON code block with this EXACT structure:

\`\`\`json
{"files":{"index.html":"<!DOCTYPE html>\\n<html>...</html>","style.css":"body { ... }","app.js":"// code here"}}
\`\`\`

RULES for the JSON block:
1. The key "files" maps to an object where each key is the filename (e.g. "index.html", "style.css", "app.js") and each value is the COMPLETE file content as a JSON string.
2. ALWAYS include the FULL, COMPLETE content of every file you create or modify — never abbreviate with "..." or "/* rest of code */" or similar placeholders.
3. Use proper JSON string escaping: newlines as \\n, quotes as \\", tabs as \\t, backslashes as \\\\.
4. If you only modify one file, still use the same format with just that one file in the object.
5. You may include explanatory text BEFORE or AFTER the JSON block, but the code MUST be inside the \`\`\`json block.

## CODING GUIDELINES
- To reference uploaded assets, use the exact CDN URL from the assets list above.
- Write production-quality, semantic HTML5 with proper accessibility attributes.
- Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) unless user requests otherwise.
- Write clean, well-structured JavaScript with event delegation and proper error handling.
- For multi-file projects: index.html is the entry point, link to style.css and app.js from it.
- Be concise in explanations. Focus on the user's actual request.
- If the user asks a question or wants discussion only (no code changes), respond normally without a JSON block.`;
}

// ─── Send Message (Streaming) ────────────────────────────────
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

aiRoutes.post('/chat', async (c) => {
  const session = c.get('session');
  const body = await c.req.json();
  const { projectId, conversationId, message, attachments } = sendMessageSchema.parse(body);

  const db = getDb();

  // Verify project ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.ownerId, session.userId)),
    with: { files: true, assets: true },
  });
  if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Project not found.');

  // Check AI usage limits
  const limits = PLAN_LIMITS[session.plan];
  if (limits.aiMessagesPerMonth !== -1) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

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
  let conversation;
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
    (conversation as any).messages = [];
  }

  // Save user message
  const [userMsg] = await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: 'user',
    content: message,
    attachments: attachments as any,
    tokensUsed: 0,
  }).returning();

  // Build Anthropic API messages
  const systemPrompt = buildSystemPrompt(
    project.files.map(f => ({ path: f.path, content: f.content })),
    project.assets.map(a => ({ filename: a.filename, cdnUrl: a.cdnUrl, mimeType: a.mimeType })),
    project.name,
  );

  const previousMessages = ((conversation as any).messages || []).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Add current message
  const apiMessages = [
    ...previousMessages,
    { role: 'user' as const, content: message },
  ];

  // Call Anthropic API (non-streaming for now — streaming SSE in future)
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
      messages: apiMessages,
    }),
  });

  if (!anthropicResponse.ok) {
    const errorBody = await anthropicResponse.text();
    console.error('[AI] Anthropic API error:', anthropicResponse.status, errorBody);
    throw new AppError(502, 'AI_ERROR', 'AI service returned an error. Please try again.');
  }

  const anthropicData = await anthropicResponse.json() as {
    content: { type: string; text: string }[];
    usage: { input_tokens: number; output_tokens: number };
  };

  const replyText = anthropicData.content
    ?.filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('') || '';

  const tokensUsed = (anthropicData.usage?.input_tokens || 0) + (anthropicData.usage?.output_tokens || 0);

  // Check if reply contains file updates and apply them to the DB
  let appliedFiles = false;
  const jsonMatch = replyText.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.files && typeof parsed.files === 'object') {
        appliedFiles = true;
        // Persist file updates to the database
        for (const [filePath, content] of Object.entries(parsed.files)) {
          if (typeof content !== 'string') continue;
          const sizeBytes = Buffer.byteLength(content, 'utf-8');
          const contentHash = require('crypto').createHash('sha256').update(content).digest('hex');
          const mimeType = filePath.endsWith('.html') ? 'text/html'
            : filePath.endsWith('.css') ? 'text/css'
            : filePath.endsWith('.js') ? 'application/javascript'
            : filePath.endsWith('.json') ? 'application/json'
            : 'text/plain';

          const existing = await db.query.projectFiles.findFirst({
            where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, filePath)),
          });

          if (existing) {
            await db.update(projectFiles)
              .set({ content, contentHash, mimeType, sizeBytes, updatedAt: new Date() })
              .where(eq(projectFiles.id, existing.id));
          } else {
            await db.insert(projectFiles).values({
              projectId, path: filePath, content, contentHash, mimeType, sizeBytes,
            });
          }
        }
        // Update project timestamp
        await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      }
    } catch { /* not valid JSON — ignore */ }
  }

  // Save assistant message
  const [assistantMsg] = await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: 'assistant',
    content: replyText,
    attachments: [],
    tokensUsed,
    appliedFiles,
  }).returning();

  // Update conversation stats
  await db.update(aiConversations).set({
    messageCount: ((conversation as any).messageCount || 0) + 2,
    totalTokensUsed: ((conversation as any).totalTokensUsed || 0) + tokensUsed,
    updatedAt: new Date(),
  }).where(eq(aiConversations.id, conversation.id));

  // Log usage
  await db.insert(usageLogs).values({
    userId: session.userId,
    organizationId: session.organizationId,
    type: 'ai_tokens',
    quantity: tokensUsed,
    metadata: { conversationId: conversation.id, model: AI_MODEL },
  });

  return c.json({
    success: true,
    data: {
      conversationId: conversation.id,
      message: {
        id: assistantMsg.id,
        role: 'assistant',
        content: replyText,
        tokensUsed,
        appliedFiles,
        createdAt: assistantMsg.createdAt.toISOString(),
      },
    },
  });
});

// ─── Stream Chat (SSE) ───────────────────────────────────────
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
  const limits = PLAN_LIMITS[session.plan];
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

  const systemPrompt = buildSystemPrompt(
    project.files.map(f => ({ path: f.path, content: f.content })),
    project.assets.map(a => ({ filename: a.filename, cdnUrl: a.cdnUrl, mimeType: a.mimeType })),
    project.name,
  );

  // Get conversation history
  const previousMessages = (conversation.messages || []).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  // Stream from Anthropic
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
      messages: [...previousMessages, { role: 'user', content: message }],
    }),
  });

  if (!anthropicResponse.ok || !anthropicResponse.body) {
    const errText = await anthropicResponse.text().catch(() => '');
    console.error('[AI Stream] Anthropic error:', anthropicResponse.status, errText);
    throw new AppError(502, 'AI_ERROR', 'AI streaming service returned an error.');
  }

  // Create a TransformStream that collects the full response while forwarding to client
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let fullContent = '';
  let inputTokens = 0;
  let outputTokens = 0;
  const convId = conversation.id;

  const { readable, writable } = new TransformStream({
    transform(chunk, controller) {
      // Forward chunk to client as-is
      controller.enqueue(chunk);

      // Also parse the SSE events to collect full text
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              fullContent += parsed.delta.text;
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              outputTokens = parsed.usage.output_tokens || 0;
            }
            if (parsed.type === 'message_start' && parsed.message?.usage) {
              inputTokens = parsed.message.usage.input_tokens || 0;
            }
          } catch { /* skip malformed */ }
        }
      }
    },
    async flush(controller) {
      // Stream is done — persist everything to DB in background
      try {
        const tokensUsed = inputTokens + outputTokens;

        // Check if reply contains file updates and apply them
        let appliedFiles = false;
        const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[1]);
            if (parsed.files && typeof parsed.files === 'object') {
              appliedFiles = true;
              for (const [filePath, content] of Object.entries(parsed.files)) {
                if (typeof content !== 'string') continue;
                const sizeBytes = Buffer.byteLength(content, 'utf-8');
                const crypto = require('crypto');
                const contentHash = crypto.createHash('sha256').update(content).digest('hex');
                const mimeType = filePath.endsWith('.html') ? 'text/html'
                  : filePath.endsWith('.css') ? 'text/css'
                  : filePath.endsWith('.js') ? 'application/javascript'
                  : filePath.endsWith('.json') ? 'application/json'
                  : 'text/plain';

                const existing = await db.query.projectFiles.findFirst({
                  where: and(eq(projectFiles.projectId, projectId), eq(projectFiles.path, filePath)),
                });

                if (existing) {
                  await db.update(projectFiles)
                    .set({ content, contentHash, mimeType, sizeBytes, updatedAt: new Date() })
                    .where(eq(projectFiles.id, existing.id));
                } else {
                  await db.insert(projectFiles).values({
                    projectId, path: filePath, content, contentHash, mimeType, sizeBytes,
                  });
                }
              }
              await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
            }
          } catch { /* not valid JSON — ignore */ }
        }

        // Save assistant message
        await db.insert(aiMessages).values({
          conversationId: convId,
          role: 'assistant',
          content: fullContent,
          attachments: [],
          tokensUsed,
          appliedFiles,
        });

        // Update conversation stats
        await db.update(aiConversations).set({
          messageCount: ((conversation as any).messageCount || 0) + 2,
          totalTokensUsed: ((conversation as any).totalTokensUsed || 0) + tokensUsed,
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

        console.log(`[AI Stream] Saved conversation ${convId}: ${tokensUsed} tokens, appliedFiles=${appliedFiles}`);
      } catch (err) {
        console.error('[AI Stream] Failed to persist after stream:', err);
      }

      // Send a final custom SSE event with the conversationId for the client
      const finalEvent = `data: ${JSON.stringify({ type: 'sbp_done', conversationId: convId, appliedFiles: fullContent.includes('```json') })}\n\n`;
      controller.enqueue(encoder.encode(finalEvent));
    },
  });

  // Pipe Anthropic's stream through our transform
  anthropicResponse.body.pipeTo(writable).catch((err) => {
    console.error('[AI Stream] Pipe error:', err);
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Conversation-Id': convId,
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
