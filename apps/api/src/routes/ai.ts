// ============================================================
// SimpleBuild Pro — AI Routes
// Real Anthropic Claude API proxy — NEVER exposes keys to client
// XML Protocol: <plan>, <explanation>, <file path="...">
// Server-side parsing → structured SSE events to frontend
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
import * as crypto from 'crypto';

export const aiRoutes = new Hono<AuthEnv>();
aiRoutes.use('*', requireAuth);
aiRoutes.use('*', rateLimiter('ai'));

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AppError(500, 'AI_NOT_CONFIGURED', 'AI service is not configured. Set ANTHROPIC_API_KEY.');
  return key;
}

// ─── Build System Prompt with XML Protocol ───────────────────
function buildSystemPrompt(
  files: { path: string; content: string }[],
  assets: { filename: string; cdnUrl: string; mimeType: string }[],
  projectName: string,
): string {
  const fileCtx = files
    .map(f => `=== ${f.path} ===\n${f.content}`)
    .join('\n\n');

  const assetList = assets
    .map(a => `- ${a.filename} (${a.mimeType}) → ${a.cdnUrl}`)
    .join('\n');

  return `You are the AI coding assistant for ${APP_NAME} Studio — a professional creation platform that builds websites, web apps, software, scripts, documents, and any digital project.
You have FULL CONTEXT of the user's project "${projectName}".

## PROJECT FILES
${fileCtx || 'No files yet. Create index.html as the entry point.'}

## UPLOADED ASSETS (${assets.length} files)
${assetList || 'None yet.'}
When referencing assets in code, use their CDN URLs directly.

## CRITICAL OUTPUT FORMAT — XML PROTOCOL

You MUST structure your response using these XML tags:

### 1. Plan (REQUIRED when creating/modifying code)
List the steps you will take:

<plan>
- Step description 1
- Step description 2
- Step description 3
</plan>

### 2. Files (REQUIRED when creating/modifying code)
Output EACH file in its own tag. ALWAYS output the COMPLETE file content — never abbreviate.

<file path="index.html">
<!DOCTYPE html>
<html lang="en">
...complete file content...
</html>
</file>

<file path="style.css">
body { margin: 0; }
...complete file content...
</file>

<file path="app.js">
// Complete JavaScript
...complete file content...
</file>

### 3. Explanation (REQUIRED — always explain what you did)
<explanation>
Brief description of what was created/changed and why.
</explanation>

## RULES
1. ALWAYS use the XML tags above when generating or modifying code.
2. Each <file> tag MUST have a path attribute and contain the FULL file content.
3. NEVER abbreviate file content — no "..." or "/* rest of code */" placeholders.
4. The <plan> comes FIRST, then <file> tags, then <explanation>.
5. If the user asks a question without needing code changes, respond with plain text (no XML tags).
6. For multi-file projects: index.html is the entry point.
7. Use Tailwind CSS via CDN (<script src="https://cdn.tailwindcss.com"></script>) for web projects unless the user requests otherwise.
8. Write production-quality, semantic HTML5 with accessibility for web projects.
9. Write clean, well-structured code in any language the user needs (JavaScript, Python, TypeScript, etc.).
10. Reference uploaded assets using their exact CDN URLs.
11. NEVER output markdown code fences (\`\`\`) around file content — use the <file> tag instead.
12. You can create ANY type of file: .html, .css, .js, .ts, .py, .json, .md, .yaml, .sh, .sql, etc.
13. For non-web projects (scripts, utilities, documents), create appropriate file structures.`;
}

// ─── XML Parser: Extract structured data from AI response ────
interface ParsedAIResponse {
  plan: string[];
  files: Record<string, string>;
  explanation: string;
  rawContent: string;
}

function parseXMLResponse(content: string): ParsedAIResponse {
  const result: ParsedAIResponse = {
    plan: [],
    files: {},
    explanation: '',
    rawContent: content,
  };

  // Extract plan
  const planMatch = content.match(/<plan>([\s\S]*?)<\/plan>/);
  if (planMatch) {
    result.plan = planMatch[1]
      .split('\n')
      .map(line => line.replace(/^[\s-]*/, '').trim())
      .filter(line => line.length > 0);
  }

  // Extract files
  const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
  let fileMatch;
  while ((fileMatch = fileRegex.exec(content)) !== null) {
    const filePath = fileMatch[1].trim();
    // Remove leading/trailing newline from content (artifact of XML formatting)
    let fileContent = fileMatch[2];
    if (fileContent.startsWith('\n')) fileContent = fileContent.slice(1);
    if (fileContent.endsWith('\n')) fileContent = fileContent.slice(0, -1);
    result.files[filePath] = fileContent;
  }

  // Extract explanation
  const explanationMatch = content.match(/<explanation>([\s\S]*?)<\/explanation>/);
  if (explanationMatch) {
    result.explanation = explanationMatch[1].trim();
  }

  // Fallback: if no XML tags found, try legacy JSON format
  if (Object.keys(result.files).length === 0) {
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.files && typeof parsed.files === 'object') {
          result.files = parsed.files;
        }
      } catch { /* ignore */ }
    }
  }

  // If no explanation found, extract text outside of tags
  if (!result.explanation) {
    let text = content;
    text = text.replace(/<plan>[\s\S]*?<\/plan>/g, '');
    text = text.replace(/<file\s+path="[^"]*">[\s\S]*?<\/file>/g, '');
    text = text.replace(/<explanation>[\s\S]*?<\/explanation>/g, '');
    text = text.replace(/```json[\s\S]*?```/g, '');
    result.explanation = text.trim();
  }

  return result;
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

// ─── Helper: Get MIME type from file path ────────────────────
function getMimeType(filePath: string): string {
  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) return 'text/html';
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'application/javascript';
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'application/typescript';
  if (filePath.endsWith('.json')) return 'application/json';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.xml')) return 'application/xml';
  if (filePath.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}

// ─── Helper: Persist files to DB ─────────────────────────────
async function persistFilesToDB(
  db: any,
  projectId: string,
  files: Record<string, string>,
): Promise<string[]> {
  const savedPaths: string[] = [];

  for (const [filePath, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;

    const sizeBytes = Buffer.byteLength(content, 'utf-8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const mimeType = getMimeType(filePath);

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

    savedPaths.push(filePath);
  }

  if (savedPaths.length > 0) {
    await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
  }

  return savedPaths;
}

// ─── Non-Streaming Chat (used as fallback) ───────────────────
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

  // Save user message
  await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: 'user',
    content: message,
    attachments: attachments as any,
    tokensUsed: 0,
  });

  // Build Anthropic API messages
  const systemPrompt = buildSystemPrompt(
    project.files.map((f: any) => ({ path: f.path, content: f.content })),
    project.assets.map((a: any) => ({ filename: a.filename, cdnUrl: a.cdnUrl, mimeType: a.mimeType })),
    project.name,
  );

  const previousMessages = (conversation.messages || []).map((m: any) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const apiMessages = [...previousMessages, { role: 'user' as const, content: message }];

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

  // Parse XML response
  const parsed = parseXMLResponse(replyText);
  const appliedFiles = Object.keys(parsed.files).length > 0;

  // Persist files to DB
  if (appliedFiles) {
    await persistFilesToDB(db, projectId, parsed.files);
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
    messageCount: (conversation.messageCount || 0) + 2,
    totalTokensUsed: (conversation.totalTokensUsed || 0) + tokensUsed,
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
        explanation: parsed.explanation,
        plan: parsed.plan,
        files: appliedFiles ? Object.keys(parsed.files) : [],
        tokensUsed,
        appliedFiles,
        createdAt: assistantMsg.createdAt.toISOString(),
      },
    },
  });
});

// ─── Stream Chat (SSE) — Server-Parsed XML Protocol ──────────
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
    project.files.map((f: any) => ({ path: f.path, content: f.content })),
    project.assets.map((a: any) => ({ filename: a.filename, cdnUrl: a.cdnUrl, mimeType: a.mimeType })),
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

  const convId = conversation.id;

  // Create our own SSE stream that sends STRUCTURED events to the client
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let fullContent = '';
  let inputTokens = 0;
  let outputTokens = 0;

  // Streaming state machine for XML parsing
  let currentState: 'idle' | 'plan' | 'file' | 'explanation' = 'idle';
  let currentFilePath = '';
  let currentFileContent = '';
  let planItems: string[] = [];
  let explanationText = '';
  let parsedFiles: Record<string, string> = {};
  let planSent = false;

  const stream = new ReadableStream({
    async start(controller) {
      // Send initial event with conversationId
      const initEvent = `data: ${JSON.stringify({ type: 'stream_start', conversationId: convId })}\n\n`;
      controller.enqueue(encoder.encode(initEvent));

      const reader = anthropicResponse.body!.getReader();
      let sseBuffer = '';

      try {
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
              const parsed = JSON.parse(data);

              if (parsed.type === 'message_start' && parsed.message?.usage) {
                inputTokens = parsed.message.usage.input_tokens || 0;
              }

              if (parsed.type === 'message_delta' && parsed.usage) {
                outputTokens = parsed.usage.output_tokens || 0;
              }

              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                const token = parsed.delta.text;
                fullContent += token;

                // Real-time XML state machine parsing
                // Detect transitions based on accumulated content

                // Check if we just received a <plan> opening
                if (currentState === 'idle' && fullContent.includes('<plan>') && !planSent) {
                  currentState = 'plan';
                  // Don't send tokens to client while in plan — wait for complete plan
                }

                // Check if plan is complete
                if (currentState === 'plan' && fullContent.includes('</plan>')) {
                  const planMatch = fullContent.match(/<plan>([\s\S]*?)<\/plan>/);
                  if (planMatch) {
                    planItems = planMatch[1]
                      .split('\n')
                      .map(l => l.replace(/^[\s-]*/, '').trim())
                      .filter(l => l.length > 0);

                    // Send plan event to client
                    const planEvent = `data: ${JSON.stringify({ type: 'plan', items: planItems })}\n\n`;
                    controller.enqueue(encoder.encode(planEvent));
                    planSent = true;
                  }
                  currentState = 'idle';
                }

                // Check for <file path="..."> opening
                if (currentState === 'idle') {
                  const fileOpenMatch = fullContent.match(/<file\s+path="([^"]+)">(?![\s\S]*<\/file>)/);
                  if (fileOpenMatch && !fullContent.includes(`<file path="${fileOpenMatch[1]}">`+ '___DONE___')) {
                    // Verify this is a NEW file tag not yet closed
                    const lastFileOpen = fullContent.lastIndexOf(`<file path="`);
                    const afterOpen = fullContent.slice(lastFileOpen);
                    if (!afterOpen.includes('</file>')) {
                      currentState = 'file';
                      currentFilePath = fileOpenMatch[1];
                      const startIdx = fullContent.indexOf('>', fullContent.lastIndexOf(`<file path="${currentFilePath}"`)) + 1;
                      currentFileContent = fullContent.slice(startIdx);

                      // Send file-start event
                      const fileStartEvent = `data: ${JSON.stringify({ type: 'file_start', path: currentFilePath })}\n\n`;
                      controller.enqueue(encoder.encode(fileStartEvent));

                      // Send accumulated content as chunk
                      if (currentFileContent.length > 0) {
                        const chunkEvent = `data: ${JSON.stringify({ type: 'file_chunk', path: currentFilePath, content: currentFileContent })}\n\n`;
                        controller.enqueue(encoder.encode(chunkEvent));
                      }
                    }
                  }
                }

                // While in file state, send new tokens as file chunks
                if (currentState === 'file') {
                  // Check if file is now complete
                  const closeTag = '</file>';
                  const fileStartTag = `<file path="${currentFilePath}">`;
                  const fileStartIdx = fullContent.lastIndexOf(fileStartTag);
                  const contentAfterOpen = fullContent.slice(fileStartIdx + fileStartTag.length);

                  if (contentAfterOpen.includes(closeTag)) {
                    // File is complete
                    const fileContent = contentAfterOpen.slice(0, contentAfterOpen.lastIndexOf(closeTag));
                    let trimmed = fileContent;
                    if (trimmed.startsWith('\n')) trimmed = trimmed.slice(1);
                    if (trimmed.endsWith('\n')) trimmed = trimmed.slice(0, -1);

                    parsedFiles[currentFilePath] = trimmed;

                    // Send file_end event with complete content
                    const fileEndEvent = `data: ${JSON.stringify({ type: 'file_end', path: currentFilePath, content: trimmed })}\n\n`;
                    controller.enqueue(encoder.encode(fileEndEvent));

                    // Mark plan item as done if applicable
                    const planIdx = Object.keys(parsedFiles).length - 1;
                    if (planIdx < planItems.length) {
                      const progressEvent = `data: ${JSON.stringify({ type: 'plan_progress', completedIndex: planIdx })}\n\n`;
                      controller.enqueue(encoder.encode(progressEvent));
                    }

                    currentState = 'idle';
                    currentFilePath = '';
                    currentFileContent = '';
                  } else {
                    // Still accumulating — send the new token as a chunk
                    const chunkEvent = `data: ${JSON.stringify({ type: 'file_chunk', path: currentFilePath, content: token })}\n\n`;
                    controller.enqueue(encoder.encode(chunkEvent));
                  }
                }

                // Check for <explanation>
                if (currentState === 'idle' && fullContent.includes('<explanation>') && !fullContent.includes('</explanation>')) {
                  currentState = 'explanation';
                }

                if (currentState === 'explanation') {
                  if (fullContent.includes('</explanation>')) {
                    const expMatch = fullContent.match(/<explanation>([\s\S]*?)<\/explanation>/);
                    if (expMatch) {
                      explanationText = expMatch[1].trim();
                      const expEvent = `data: ${JSON.stringify({ type: 'explanation', text: explanationText })}\n\n`;
                      controller.enqueue(encoder.encode(expEvent));
                    }
                    currentState = 'idle';
                  }
                }

                // For text outside XML tags (fallback — plain text response)
                if (currentState === 'idle' && !fullContent.includes('<plan>') && !fullContent.includes('<file ') && !fullContent.includes('<explanation>')) {
                  // This is a plain text response (no code generation)
                  const textEvent = `data: ${JSON.stringify({ type: 'text_token', token })}\n\n`;
                  controller.enqueue(encoder.encode(textEvent));
                }
              }
            } catch { /* skip malformed SSE */ }
          }
        }

        // Stream complete — handle any remaining content
        // If we ended in file state without closing tag, try to salvage
        if (currentState === 'file' && currentFilePath) {
          const parsed2 = parseXMLResponse(fullContent);
          if (parsed2.files[currentFilePath]) {
            parsedFiles[currentFilePath] = parsed2.files[currentFilePath];
            const fileEndEvent = `data: ${JSON.stringify({ type: 'file_end', path: currentFilePath, content: parsed2.files[currentFilePath] })}\n\n`;
            controller.enqueue(encoder.encode(fileEndEvent));
          }
        }

        // Final parse to catch anything missed
        if (Object.keys(parsedFiles).length === 0) {
          const fallback = parseXMLResponse(fullContent);
          if (Object.keys(fallback.files).length > 0) {
            parsedFiles = fallback.files;
            for (const [path, content] of Object.entries(parsedFiles)) {
              const fileEndEvent = `data: ${JSON.stringify({ type: 'file_end', path, content })}\n\n`;
              controller.enqueue(encoder.encode(fileEndEvent));
            }
          }
          if (fallback.explanation && !explanationText) {
            explanationText = fallback.explanation;
            const expEvent = `data: ${JSON.stringify({ type: 'explanation', text: explanationText })}\n\n`;
            controller.enqueue(encoder.encode(expEvent));
          }
          if (fallback.plan.length > 0 && !planSent) {
            planItems = fallback.plan;
            const planEvent = `data: ${JSON.stringify({ type: 'plan', items: planItems })}\n\n`;
            controller.enqueue(encoder.encode(planEvent));
          }
        }

        // Persist files to DB
        const appliedFiles = Object.keys(parsedFiles).length > 0;
        if (appliedFiles) {
          await persistFilesToDB(db, projectId, parsedFiles);
        }

        const tokensUsed = inputTokens + outputTokens;

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

        console.log(`[AI Stream] Done — conv=${convId}, tokens=${tokensUsed}, files=${Object.keys(parsedFiles).length}`);

        // Send final done event
        const doneEvent = `data: ${JSON.stringify({
          type: 'stream_end',
          conversationId: convId,
          appliedFiles,
          filesPaths: Object.keys(parsedFiles),
          tokensUsed,
        })}\n\n`;
        controller.enqueue(encoder.encode(doneEvent));

      } catch (err: any) {
        console.error('[AI Stream] Error:', err);
        const errorEvent = `data: ${JSON.stringify({ type: 'error', message: err.message || 'Stream error' })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Conversation-Id': convId,
      'Access-Control-Expose-Headers': 'X-Conversation-Id',
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
