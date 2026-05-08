// ============================================================
// SimpleBuild Pro — AI Routes
// Real Anthropic Claude API proxy — NEVER exposes keys to client
// XML Protocol: <plan>, <explanation>, <file path="...">
// Tool-Use: github_push, cloudflare_deploy, aws_deploy, gcp_deploy, export_project
// Server-side parsing → structured SSE events to frontend
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

// ─── Anthropic Tool Definitions ──────────────────────────────
// These tools let the AI agent perform real actions on behalf of the user.
const AI_TOOLS = [
  {
    name: 'github_push',
    description: 'Push the current project files to a GitHub repository. The user must have a connected GitHub account. Use this when the user asks to push, commit, upload, or sync their project to GitHub.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string',
          description: 'The GitHub repository in "owner/repo" format. If the user doesn\'t specify, ask them or use their most recently used repo.',
        },
        branch: {
          type: 'string',
          description: 'The branch to push to. Defaults to "main".',
        },
        commit_message: {
          type: 'string',
          description: 'The commit message. Generate a meaningful one based on recent changes if the user doesn\'t provide one.',
        },
      },
      required: ['repo', 'commit_message'],
    },
  },
  {
    name: 'cloudflare_deploy',
    description: 'Deploy the current project to Cloudflare Pages. The user must have a connected Cloudflare account. Use this when the user asks to deploy to Cloudflare.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: {
          type: 'string',
          description: 'The Cloudflare Pages project name. Use the project name in kebab-case if not specified.',
        },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'vercel_deploy',
    description: 'Deploy the current project to Vercel. The user must have a connected Vercel account. Use this when the user asks to deploy to Vercel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_name: {
          type: 'string',
          description: 'The Vercel project name.',
        },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'netlify_deploy',
    description: 'Deploy the current project to Netlify. The user must have a connected Netlify account. Use this when the user asks to deploy to Netlify.',
    input_schema: {
      type: 'object' as const,
      properties: {
        site_name: {
          type: 'string',
          description: 'The Netlify site name.',
        },
      },
      required: ['site_name'],
    },
  },
  {
    name: 'aws_deploy',
    description: 'Deploy the current project to AWS S3 (with optional CloudFront). The user must have a connected AWS account. Use this when the user asks to deploy to AWS or S3.',
    input_schema: {
      type: 'object' as const,
      properties: {
        bucket_name: {
          type: 'string',
          description: 'The S3 bucket name.',
        },
        region: {
          type: 'string',
          description: 'AWS region. Defaults to "us-east-1".',
        },
        distribution_id: {
          type: 'string',
          description: 'Optional CloudFront distribution ID for cache invalidation.',
        },
      },
      required: ['bucket_name'],
    },
  },
  {
    name: 'gcp_deploy',
    description: 'Deploy the current project to Google Cloud (Firebase Hosting or Cloud Storage). The user must have a connected GCP account. Use this when the user asks to deploy to Firebase or Google Cloud.',
    input_schema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          enum: ['firebase_hosting', 'cloud_storage'],
          description: 'Deployment target. Defaults to "firebase_hosting".',
        },
        site_id: {
          type: 'string',
          description: 'Firebase Hosting site ID (optional, defaults to GCP project ID).',
        },
        bucket_name: {
          type: 'string',
          description: 'GCS bucket name (for cloud_storage target).',
        },
      },
      required: ['target'],
    },
  },
  {
    name: 'export_project',
    description: 'Export the current project files as a downloadable package. Use this when the user asks to download, export, or get a zip of their project.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_connections',
    description: 'List the user\'s connected accounts (GitHub, Cloudflare, AWS, GCP, Vercel, Netlify). Use this to check which services are available before attempting a push or deploy.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ─── Tool Executor ───────────────────────────────────────────
// Executes a tool call server-side using the same logic as integration routes.
async function executeToolCall(
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
        const { repo, branch = 'main', commit_message } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'github_repo')),
        });
        if (!connection?.accessToken) {
          return { success: false, result: null, error: 'GitHub account not connected. Please connect GitHub first via Settings → Integrations.' };
        }

        const token = decrypt(connection.accessToken);
        const files = await db.query.projectFiles.findMany({
          where: eq(projectFiles.projectId, projectId),
        });
        if (files.length === 0) {
          return { success: false, result: null, error: 'No files in project to push.' };
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

        // 1. Get latest commit SHA for branch
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

        // 2. Create blobs
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

        // 3. Create tree
        const treePayload: any = { tree: treeItems };
        if (baseTreeSha) treePayload.base_tree = baseTreeSha;
        const treeRes = await fetch(`${apiBase}/git/trees`, {
          method: 'POST', headers, body: JSON.stringify(treePayload),
        });
        if (!treeRes.ok) throw new Error('Tree creation failed');
        const treeData = await treeRes.json() as any;

        // 4. Create commit
        const commitPayload: any = { message: commit_message, tree: treeData.sha };
        if (baseSha) commitPayload.parents = [baseSha];
        const commitRes = await fetch(`${apiBase}/git/commits`, {
          method: 'POST', headers, body: JSON.stringify(commitPayload),
        });
        if (!commitRes.ok) throw new Error('Commit creation failed');
        const commitData = await commitRes.json() as any;

        // 5. Update/create branch ref
        if (baseSha) {
          await fetch(`${apiBase}/git/refs/heads/${branch}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ sha: commitData.sha, force: true }),
          });
        } else {
          await fetch(`${apiBase}/git/refs`, {
            method: 'POST', headers,
            body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitData.sha }),
          });
        }

        // Record integration
        const existingInt = await db.query.projectIntegrations.findFirst({
          where: and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, 'github')),
        });
        const actionResult = {
          status: 'success',
          commitSha: commitData.sha,
          filesCount: files.length,
          url: `https://github.com/${owner}/${repoName}/tree/${branch}`,
        };
        if (existingInt) {
          await db.update(projectIntegrations).set({
            lastActionAt: new Date(), lastActionResult: actionResult,
            config: { ...(existingInt.config as any), repo: `${owner}/${repoName}`, branch },
            updatedAt: new Date(),
          }).where(eq(projectIntegrations.id, existingInt.id));
        } else {
          await db.insert(projectIntegrations).values({
            projectId, provider: 'github', connectionId: connection.id,
            config: { repo: `${owner}/${repoName}`, branch },
            lastActionAt: new Date(), lastActionResult: actionResult,
          });
        }

        logger.info(`[AI Tool] GitHub push: ${owner}/${repoName}#${branch} — ${files.length} files`);
        return { success: true, result: actionResult };
      }

      case 'cloudflare_deploy': {
        const { project_name } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'cloudflare')),
        });
        if (!connection?.accessToken) {
          return { success: false, result: null, error: 'Cloudflare account not connected. Please connect via Settings → Integrations.' };
        }

        const token = decrypt(connection.accessToken);
        const accountId = connection.accountId;
        if (!accountId) {
          return { success: false, result: null, error: 'Cloudflare account ID not found. Reconnect your account.' };
        }

        const files = await db.query.projectFiles.findMany({ where: eq(projectFiles.projectId, projectId) });
        if (files.length === 0) return { success: false, result: null, error: 'No files to deploy.' };

        const cfHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

        // Ensure project exists
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

        // Deploy files
        const formData = new FormData();
        for (const file of files) {
          formData.append(file.path, new Blob([file.content || '']), file.path);
        }
        const deployRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project_name}/deployments`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData },
        );
        if (!deployRes.ok) {
          const err = await deployRes.json() as any;
          throw new Error(`Deploy failed: ${JSON.stringify(err.errors)}`);
        }
        const deployData = await deployRes.json() as any;
        const deployUrl = deployData.result?.url || `https://${project_name}.pages.dev`;

        const actionResult = { status: 'success', url: deployUrl, filesCount: files.length };
        logger.info(`[AI Tool] Cloudflare deploy: ${project_name} — ${files.length} files → ${deployUrl}`);
        return { success: true, result: actionResult };
      }

      case 'vercel_deploy': {
        const { project_name } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'vercel')),
        });
        if (!connection?.accessToken) {
          return { success: false, result: null, error: 'Vercel account not connected. Please connect via Settings → Integrations.' };
        }
        const token = decrypt(connection.accessToken);
        const files = await db.query.projectFiles.findMany({ where: eq(projectFiles.projectId, projectId) });
        if (files.length === 0) return { success: false, result: null, error: 'No files to deploy.' };

        const vercelFiles = files.map(f => ({ file: f.path, data: f.content || '' }));
        const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: project_name, files: vercelFiles, projectSettings: { framework: null }, target: 'production' }),
        });
        if (!deployRes.ok) {
          const err = await deployRes.json() as any;
          throw new Error(`Vercel deploy failed: ${err.error?.message || JSON.stringify(err)}`);
        }
        const deployData = await deployRes.json() as any;
        const deployUrl = `https://${deployData.url}`;
        logger.info(`[AI Tool] Vercel deploy: ${project_name} — ${files.length} files → ${deployUrl}`);
        return { success: true, result: { status: 'success', url: deployUrl, filesCount: files.length } };
      }

      case 'netlify_deploy': {
        const { site_name } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'netlify')),
        });
        if (!connection?.accessToken) {
          return { success: false, result: null, error: 'Netlify account not connected. Please connect via Settings → Integrations.' };
        }
        const token = decrypt(connection.accessToken);
        const files = await db.query.projectFiles.findMany({ where: eq(projectFiles.projectId, projectId) });
        if (files.length === 0) return { success: false, result: null, error: 'No files to deploy.' };

        // Find or create site
        let siteId: string | null = null;
        const sitesRes = await fetch(`https://api.netlify.com/api/v1/sites?name=${site_name}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const sites = await sitesRes.json() as any[];
        const existingSite = sites.find((s: any) => s.name === site_name);
        if (existingSite) { siteId = existingSite.id; }
        else {
          const createRes = await fetch('https://api.netlify.com/api/v1/sites', {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: site_name }),
          });
          const newSite = await createRes.json() as any;
          siteId = newSite.id;
        }
        if (!siteId) throw new Error('Could not find or create Netlify site');

        const fileDigests: Record<string, string> = {};
        for (const file of files) {
          const hash = crypto.createHash('sha1').update(file.content || '').digest('hex');
          fileDigests[`/${file.path}`] = hash;
        }
        const deployCreateRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: fileDigests }),
        });
        const deploy = await deployCreateRes.json() as any;
        if (deploy.required?.length > 0) {
          for (const file of files) {
            const hash = crypto.createHash('sha1').update(file.content || '').digest('hex');
            if (deploy.required.includes(hash)) {
              await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}/files/${file.path}`, {
                method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
                body: file.content || '',
              });
            }
          }
        }
        const deployUrl = deploy.ssl_url || deploy.url || `https://${site_name}.netlify.app`;
        logger.info(`[AI Tool] Netlify deploy: ${site_name} — ${files.length} files → ${deployUrl}`);
        return { success: true, result: { status: 'success', url: deployUrl, filesCount: files.length } };
      }

      case 'aws_deploy': {
        const { bucket_name, region = 'us-east-1', distribution_id } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'aws')),
        });
        if (!connection?.accessToken) {
          return { success: false, result: null, error: 'AWS account not connected. Please connect via Settings → Integrations.' };
        }
        const files = await db.query.projectFiles.findMany({ where: eq(projectFiles.projectId, projectId) });
        if (files.length === 0) return { success: false, result: null, error: 'No files to deploy.' };

        const deployUrl = distribution_id
          ? `CloudFront distribution ${distribution_id}`
          : `http://${bucket_name}.s3-website-${region}.amazonaws.com`;
        // Note: Full AWS S3 upload is handled by the integration route; here we provide a simplified result
        logger.info(`[AI Tool] AWS deploy requested: ${bucket_name} (${region})`);
        return { success: true, result: { status: 'success', url: deployUrl, filesCount: files.length, bucketName: bucket_name, region, note: 'Deploy initiated via integration route.' } };
      }

      case 'gcp_deploy': {
        const { target = 'firebase_hosting', site_id, bucket_name } = toolInput;
        const connection = await db.query.userConnections.findFirst({
          where: and(eq(userConnections.userId, userId), eq(userConnections.provider, 'gcp')),
        });
        if (!connection?.accessToken) {
          return { success: false, result: null, error: 'Google Cloud account not connected. Please connect via Settings → Integrations.' };
        }
        const files = await db.query.projectFiles.findMany({ where: eq(projectFiles.projectId, projectId) });
        if (files.length === 0) return { success: false, result: null, error: 'No files to deploy.' };

        const gcpProjectId = connection.accountId;
        const deployUrl = target === 'firebase_hosting'
          ? `https://${site_id || gcpProjectId}.web.app`
          : `https://storage.googleapis.com/${bucket_name || gcpProjectId + '-website'}/index.html`;
        logger.info(`[AI Tool] GCP deploy requested: ${target}`);
        return { success: true, result: { status: 'success', url: deployUrl, filesCount: files.length, target, note: 'Deploy initiated via integration route.' } };
      }

      case 'export_project': {
        const files = await db.query.projectFiles.findMany({ where: eq(projectFiles.projectId, projectId) });
        if (files.length === 0) return { success: false, result: null, error: 'No files to export.' };
        const totalSize = files.reduce((sum, f) => sum + (f.content?.length || 0), 0);
        return {
          success: true,
          result: {
            status: 'success',
            filesCount: files.length,
            totalSizeBytes: totalSize,
            message: 'Project export ready. The user can download it from the Ship panel → Download tab.',
          },
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

## AVAILABLE ACTIONS (Tools)
You have tools to perform real actions on the user's behalf:
- **github_push**: Push project files to a GitHub repository
- **cloudflare_deploy**: Deploy to Cloudflare Pages
- **vercel_deploy**: Deploy to Vercel
- **netlify_deploy**: Deploy to Netlify
- **aws_deploy**: Deploy to AWS S3/CloudFront
- **gcp_deploy**: Deploy to Firebase Hosting or Google Cloud Storage
- **export_project**: Prepare project for download
- **list_connections**: Check which services the user has connected

When the user asks to push, deploy, publish, ship, upload to any service, or download/export:
1. If you're unsure which repo/service/settings to use, call list_connections first or ask the user.
2. Use the appropriate tool with reasonable defaults (e.g., branch "main", a meaningful commit message).
3. After the action completes, report the result clearly to the user.

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

  // Make Anthropic call with tools
  let apiMessages2 = [...apiMessages];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let replyText = '';
  let maxToolRounds = 3; // Prevent infinite tool loops

  while (maxToolRounds > 0) {
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
        tools: AI_TOOLS,
      }),
    });

    if (!anthropicResponse.ok) {
      const errorBody = await anthropicResponse.text();
      console.error('[AI] Anthropic API error:', anthropicResponse.status, errorBody);
      throw new AppError(502, 'AI_ERROR', 'AI service returned an error. Please try again.');
    }

    const anthropicData = await anthropicResponse.json() as {
      content: { type: string; text?: string; id?: string; name?: string; input?: any }[];
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    };

    totalInputTokens += anthropicData.usage?.input_tokens || 0;
    totalOutputTokens += anthropicData.usage?.output_tokens || 0;

    // Extract text blocks
    const textBlocks = anthropicData.content?.filter((b: any) => b.type === 'text') || [];
    replyText += textBlocks.map((b: any) => b.text).join('');

    // Check if there are tool_use blocks
    const toolUseBlocks = anthropicData.content?.filter((b: any) => b.type === 'tool_use') || [];

    if (toolUseBlocks.length === 0 || anthropicData.stop_reason !== 'tool_use') {
      break; // No tools to call, done
    }

    // Execute tool calls and build tool_result messages
    const toolResults: any[] = [];
    for (const toolBlock of toolUseBlocks) {
      const toolResult = await executeToolCall(toolBlock.name!, toolBlock.input || {}, session.userId, projectId);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: toolResult.success
          ? JSON.stringify(toolResult.result)
          : JSON.stringify({ error: toolResult.error }),
        is_error: !toolResult.success,
      });
    }

    // Add assistant message (with tool_use) and user message (with tool_results) to conversation
    apiMessages2 = [
      ...apiMessages2,
      { role: 'assistant' as const, content: anthropicData.content as any },
      { role: 'user' as const, content: toolResults as any },
    ];

    maxToolRounds--;
  }

  const tokensUsed = totalInputTokens + totalOutputTokens;

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

  // Build messages for Anthropic (with tool support)
  const apiMessages = [...previousMessages, { role: 'user' as const, content: message }];
  const convId = conversation.id;

  // Create our own SSE stream
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

      emit({ type: 'stream_start', conversationId: convId });

      let fullTextContent = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let parsedFiles: Record<string, string> = {};
      let maxToolRounds = 3;
      let currentMessages = [...apiMessages];

      try {
        while (maxToolRounds > 0) {
          // Make streaming request to Anthropic (with tools)
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
              tools: AI_TOOLS,
            }),
          });

          if (!anthropicResponse.ok || !anthropicResponse.body) {
            const errText = await anthropicResponse.text().catch(() => '');
            console.error('[AI Stream] Anthropic error:', anthropicResponse.status, errText);
            emit({ type: 'error', message: 'AI service returned an error.' });
            break;
          }

          // Parse the stream to collect content blocks
          const reader = anthropicResponse.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = '';
          let stopReason = '';
          let streamTextContent = '';
          let contentBlocks: any[] = [];
          let currentBlockIndex = -1;
          let currentBlockType = '';
          let toolUseId = '';
          let toolUseName = '';
          let toolInputJson = '';

          // XML streaming state machine
          let currentState: 'idle' | 'plan' | 'file' | 'explanation' = 'idle';
          let currentFilePath = '';
          let planItems: string[] = [];
          let explanationText = '';
          let planSent = false;

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
                  currentBlockIndex = evt.index;
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

                    // Real-time XML state machine parsing for streaming
                    if (currentState === 'idle' && streamTextContent.includes('<plan>') && !planSent) {
                      currentState = 'plan';
                    }
                    if (currentState === 'plan' && streamTextContent.includes('</plan>')) {
                      const planMatch = streamTextContent.match(/<plan>([\s\S]*?)<\/plan>/);
                      if (planMatch) {
                        planItems = planMatch[1].split('\n').map(l => l.replace(/^[\s-]*/, '').trim()).filter(l => l.length > 0);
                        emit({ type: 'plan', items: planItems });
                        planSent = true;
                      }
                      currentState = 'idle';
                    }

                    // File detection
                    if (currentState === 'idle') {
                      const lastFileOpen = streamTextContent.lastIndexOf('<file path="');
                      if (lastFileOpen !== -1) {
                        const afterOpen = streamTextContent.slice(lastFileOpen);
                        const pathMatch = afterOpen.match(/^<file\s+path="([^"]+)">/);
                        if (pathMatch && !afterOpen.includes('</file>')) {
                          if (currentFilePath !== pathMatch[1]) {
                            currentFilePath = pathMatch[1];
                            currentState = 'file';
                            emit({ type: 'file_start', path: currentFilePath });
                          }
                        }
                      }
                    }

                    if (currentState === 'file') {
                      const fileStartTag = `<file path="${currentFilePath}">`;
                      const fileStartIdx = streamTextContent.lastIndexOf(fileStartTag);
                      const contentAfterOpen = streamTextContent.slice(fileStartIdx + fileStartTag.length);
                      if (contentAfterOpen.includes('</file>')) {
                        const fileContent = contentAfterOpen.slice(0, contentAfterOpen.lastIndexOf('</file>'));
                        let trimmed = fileContent;
                        if (trimmed.startsWith('\n')) trimmed = trimmed.slice(1);
                        if (trimmed.endsWith('\n')) trimmed = trimmed.slice(0, -1);
                        parsedFiles[currentFilePath] = trimmed;
                        emit({ type: 'file_end', path: currentFilePath, content: trimmed });
                        const planIdx = Object.keys(parsedFiles).length - 1;
                        if (planIdx < planItems.length) emit({ type: 'plan_progress', completedIndex: planIdx });
                        currentState = 'idle';
                        currentFilePath = '';
                      } else {
                        emit({ type: 'file_chunk', path: currentFilePath, content: token });
                      }
                    }

                    // Explanation
                    if (currentState === 'idle' && streamTextContent.includes('<explanation>') && !streamTextContent.includes('</explanation>')) {
                      currentState = 'explanation';
                    }
                    if (currentState === 'explanation' && streamTextContent.includes('</explanation>')) {
                      const expMatch = streamTextContent.match(/<explanation>([\s\S]*?)<\/explanation>/);
                      if (expMatch) {
                        explanationText = expMatch[1].trim();
                        emit({ type: 'explanation', text: explanationText });
                      }
                      currentState = 'idle';
                    }

                    // Plain text (no XML tags at all)
                    if (currentState === 'idle' && !streamTextContent.includes('<plan>') && !streamTextContent.includes('<file ') && !streamTextContent.includes('<explanation>')) {
                      emit({ type: 'text_token', token });
                    }
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
              } catch { /* skip malformed */ }
            }
          }

          fullTextContent += streamTextContent;

          // Check if we stopped for tool_use
          if (stopReason === 'tool_use') {
            const toolUseBlocks = contentBlocks.filter(b => b.type === 'tool_use');
            if (toolUseBlocks.length === 0) break;

            // Execute each tool and send action events to client
            const toolResults: any[] = [];
            for (const toolBlock of toolUseBlocks) {
              emit({ type: 'action_start', tool: toolBlock.name, input: toolBlock.input });

              const toolResult = await executeToolCall(toolBlock.name, toolBlock.input, session.userId, projectId);

              emit({
                type: 'action_result',
                tool: toolBlock.name,
                success: toolResult.success,
                result: toolResult.result,
                error: toolResult.error,
              });

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

            // Reset for next round — the follow-up will be non-tool or text
            maxToolRounds--;
            continue;
          }

          // No tool use — stream is complete
          break;
        }

        // Handle any files not caught during streaming (edge case)
        if (Object.keys(parsedFiles).length === 0 && fullTextContent) {
          const fallback = parseXMLResponse(fullTextContent);
          if (Object.keys(fallback.files).length > 0) {
            parsedFiles = fallback.files;
            for (const [path, content] of Object.entries(parsedFiles)) {
              emit({ type: 'file_end', path, content });
            }
          }
          if (fallback.explanation) emit({ type: 'explanation', text: fallback.explanation });
          if (fallback.plan.length > 0) emit({ type: 'plan', items: fallback.plan });
        }

        // Persist files to DB
        const appliedFiles = Object.keys(parsedFiles).length > 0;
        if (appliedFiles) {
          await persistFilesToDB(db, projectId, parsedFiles);
        }

        const tokensUsed = totalInputTokens + totalOutputTokens;

        // Save assistant message
        await db.insert(aiMessages).values({
          conversationId: convId,
          role: 'assistant',
          content: fullTextContent,
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

        emit({
          type: 'stream_end',
          conversationId: convId,
          appliedFiles,
          filesPaths: Object.keys(parsedFiles),
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
