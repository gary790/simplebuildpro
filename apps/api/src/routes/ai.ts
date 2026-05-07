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

  return `You are the AI assistant for ${APP_NAME}, an enterprise website builder platform.
You have FULL CONTEXT of the user's project "${projectName}" — all source files and uploaded assets.

## PROJECT FILES
${fileCtx || 'No files yet.'}

## UPLOADED ASSETS (${assets.length} files)
${assetList || 'None yet.'}
When referencing assets in code, use their CDN URLs directly in src attributes.

## RULES
- You can see all project files and assets in real time.
- When modifying code, return a JSON block with ALL files that should be updated:
\`\`\`json
{"files": {"index.html": "...", "style.css": "...", "app.js": "..."}}
\`\`\`
- ALWAYS return the COMPLETE file content — never use placeholders like "..." or "rest of code".
- To reference uploaded assets, use the exact CDN URL from the assets list above.
- You can also discuss, debug, explain, or brainstorm without modifying files.
- Write production-quality, semantic HTML5 with proper accessibility attributes.
- Use modern CSS (custom properties, flexbox, grid) — no frameworks unless the user requests one.
- Write clean, well-structured JavaScript with event delegation and proper error handling.
- Be concise and direct. Focus on the user's actual request.`;
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

  // Check if reply contains file updates
  let appliedFiles = false;
  const jsonMatch = replyText.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.files && typeof parsed.files === 'object') {
        appliedFiles = true;
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

  const systemPrompt = buildSystemPrompt(
    project.files.map(f => ({ path: f.path, content: f.content })),
    project.assets.map(a => ({ filename: a.filename, cdnUrl: a.cdnUrl, mimeType: a.mimeType })),
    project.name,
  );

  // Get conversation history
  let previousMessages: { role: string; content: string }[] = [];
  if (conversationId) {
    const conv = await db.query.aiConversations.findFirst({
      where: eq(aiConversations.id, conversationId),
      with: { messages: { orderBy: aiMessages.createdAt, limit: 50 } },
    });
    if (conv) {
      previousMessages = conv.messages.map(m => ({ role: m.role, content: m.content }));
    }
  }

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
    throw new AppError(502, 'AI_ERROR', 'AI streaming service returned an error.');
  }

  // Return SSE stream
  return new Response(anthropicResponse.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Conversation-Id': conversationId || 'new',
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
