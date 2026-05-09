// ============================================================
// SimpleBuild Pro — Core Type Definitions
// Production types — no mocks, no fakes
// ============================================================

// ─── Auth ────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  plan: UserPlan;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UserPlan = 'free' | 'pro' | 'business' | 'enterprise';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Session {
  userId: string;
  email: string;
  name: string;
  plan: UserPlan;
  organizationId: string | null;
}

// ─── Organizations ───────────────────────────────────────────
export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: UserPlan;
  createdAt: string;
}

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface OrgMember {
  userId: string;
  organizationId: string;
  role: OrgRole;
  user: Pick<User, 'id' | 'email' | 'name' | 'avatarUrl'>;
}

// ─── Projects ────────────────────────────────────────────────
export interface Project {
  id: string;
  organizationId: string | null;
  ownerId: string;
  name: string;
  slug: string;
  description: string | null;
  templateId: string | null;
  settings: ProjectSettings;
  status: ProjectStatus;
  lastDeployedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectStatus = 'draft' | 'published' | 'archived';

export interface ProjectSettings {
  framework: 'static' | 'react' | 'vue' | 'svelte';
  cssFramework: 'none' | 'tailwind' | 'bootstrap';
  customDomain: string | null;
  favicon: string | null;
  meta: {
    title: string;
    description: string;
    ogImage: string | null;
  };
}

// ─── Project Files ───────────────────────────────────────────
export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  content: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  mimeType?: string;
  sizeBytes?: number;
  children?: FileTreeNode[];
}

// ─── Assets ──────────────────────────────────────────────────
export interface ProjectAsset {
  id: string;
  projectId: string;
  filename: string;
  originalFilename: string;
  gcsKey: string;
  cdnUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export type AssetType = 'image' | 'video' | 'audio' | 'font' | 'pdf' | 'other';

// ─── Versions ────────────────────────────────────────────────
export interface ProjectVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  snapshotGcsKey: string;
  message: string;
  createdBy: string;
  fileCount: number;
  totalSizeBytes: number;
  createdAt: string;
}

// ─── Deployments ─────────────────────────────────────────────
export interface Deployment {
  id: string;
  projectId: string;
  versionId: string;
  status: DeploymentStatus;
  url: string;
  cdnUrl: string | null;
  customDomain: string | null;
  gcsPrefix: string;
  buildDurationMs: number | null;
  lighthouseScore: number | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

export type DeploymentStatus =
  | 'queued'
  | 'building'
  | 'deploying'
  | 'live'
  | 'failed'
  | 'rolled_back';

export interface CustomDomain {
  id: string;
  projectId: string;
  domain: string;
  sslStatus: 'pending' | 'active' | 'expired' | 'error';
  dnsVerified: boolean;
  dnsRecords: DnsRecord[];
  createdAt: string;
}

export interface DnsRecord {
  type: 'CNAME' | 'A' | 'TXT';
  name: string;
  value: string;
}

// ─── AI Chat ─────────────────────────────────────────────────
export interface AiConversation {
  id: string;
  projectId: string;
  userId: string;
  messageCount: number;
  totalTokensUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments: AiAttachment[];
  tokensUsed: number;
  appliedFiles: boolean;
  createdAt: string;
}

export interface AiAttachment {
  id: string;
  filename: string;
  mimeType: string;
  url: string;
  sizeBytes: number;
}

// ─── Preview (Novita Sandbox) ────────────────────────────────
export interface PreviewSession {
  id: string;
  projectId: string;
  sandboxId: string;
  previewUrl: string;
  status: 'creating' | 'running' | 'paused' | 'stopped' | 'error';
  expiresAt: string;
  createdAt: string;
}

// ─── Build ───────────────────────────────────────────────────
export interface BuildResult {
  success: boolean;
  outputGcsKey: string | null;
  files: BuildOutputFile[];
  totalSizeBytes: number;
  durationMs: number;
  errors: BuildError[];
  warnings: BuildWarning[];
  lighthouseScore: number | null;
}

export interface BuildOutputFile {
  path: string;
  sizeBytes: number;
  contentHash: string;
  gcsKey: string;
}

export interface BuildError {
  file: string;
  line: number | null;
  column: number | null;
  message: string;
  severity: 'error' | 'warning';
}

export interface BuildWarning {
  file: string;
  message: string;
  suggestion: string | null;
}

// ─── Billing ─────────────────────────────────────────────────
export interface Subscription {
  id: string;
  organizationId: string;
  stripeSubscriptionId: string;
  plan: UserPlan;
  status: 'active' | 'past_due' | 'canceled' | 'trialing';
  currentPeriodEnd: string;
}

export interface UsageMetrics {
  aiTokensUsed: number;
  aiTokensLimit: number;
  deploysUsed: number;
  deploysLimit: number;
  storageUsedBytes: number;
  storageLimitBytes: number;
  projectsCount: number;
  projectsLimit: number;
  customDomainsCount: number;
  customDomainsLimit: number;
}

// ─── API Response Wrappers ───────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: never;
}

export interface ApiError {
  success: false;
  data?: never;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiResult<T> = ApiResponse<T> | ApiError;

// ─── Pagination ──────────────────────────────────────────────
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ─── WebSocket Events ────────────────────────────────────────
export type WsEvent =
  | { type: 'file:updated'; data: { projectId: string; path: string; content: string } }
  | { type: 'file:created'; data: { projectId: string; path: string; content: string } }
  | { type: 'file:deleted'; data: { projectId: string; path: string } }
  | { type: 'preview:ready'; data: { projectId: string; url: string } }
  | { type: 'preview:error'; data: { projectId: string; error: string } }
  | { type: 'build:progress'; data: { projectId: string; step: string; progress: number } }
  | { type: 'build:complete'; data: { projectId: string; result: BuildResult } }
  | { type: 'deploy:progress'; data: { deploymentId: string; status: DeploymentStatus } }
  | { type: 'deploy:complete'; data: { deploymentId: string; url: string } }
  | { type: 'ai:token'; data: { conversationId: string; token: string } }
  | { type: 'ai:complete'; data: { conversationId: string; messageId: string } };
