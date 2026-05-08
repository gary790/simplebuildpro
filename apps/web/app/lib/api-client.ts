// ============================================================
// SimpleBuild Pro — API Client
// Typed HTTP client for frontend → API communication
// Real endpoints — no mocks, no fakes
// ============================================================

import type {
  User, AuthTokens, Project, ProjectFile, ProjectAsset,
  ProjectVersion, Deployment, AiConversation, AiMessage,
  PreviewSession, PaginatedResponse, ApiResult,
} from '@simplebuildpro/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// ─── Token Management ───────────────────────────────────────
let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(tokens: AuthTokens): void {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  if (typeof window !== 'undefined') {
    localStorage.setItem('sbp_refresh_token', tokens.refreshToken);
  }
}

export function clearTokens(): void {
  accessToken = null;
  refreshToken = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('sbp_refresh_token');
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function loadStoredRefreshToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('sbp_refresh_token');
  }
  return null;
}

// ─── Core Fetch Wrapper ─────────────────────────────────────
async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(url, { ...options, headers });

  // Handle token expiry — auto-refresh
  if (res.status === 401 && retry && refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, options, false);
    }
    // Refresh failed — clear and redirect to login
    clearTokens();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Session expired. Please log in again.');
  }

  const json = await res.json();

  if (!res.ok || json.success === false) {
    const error = json.error || { code: 'UNKNOWN', message: 'Request failed' };
    throw new ApiError(res.status, error.code, error.message, error.details);
  }

  return json.data as T;
}

async function refreshAccessToken(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) return false;

    const json = await res.json();
    if (json.success && json.data?.tokens) {
      setTokens(json.data.tokens);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ─── Error Class ────────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Auth API ───────────────────────────────────────────────
export const authApi = {
  signup: (data: { email: string; password: string; name: string }) =>
    apiFetch<{ user: User; tokens: AuthTokens }>('/api/v1/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    apiFetch<{ user: User; tokens: AuthTokens }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  logout: () =>
    apiFetch<{ message: string }>('/api/v1/auth/logout', { method: 'POST' }),

  getMe: () =>
    apiFetch<User>('/api/v1/auth/me'),

  updateProfile: (data: { name?: string; avatarUrl?: string | null }) =>
    apiFetch<User>('/api/v1/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    apiFetch<{ message: string }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ─── Projects API ───────────────────────────────────────────
export const projectsApi = {
  list: (params?: { page?: number; pageSize?: number; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.pageSize) query.set('pageSize', String(params.pageSize));
    if (params?.status) query.set('status', params.status);
    return apiFetch<PaginatedResponse<Project>>(`/api/v1/projects?${query}`);
  },

  get: (id: string) =>
    apiFetch<Project & { files: ProjectFile[]; assets: ProjectAsset[]; versions: ProjectVersion[] }>(
      `/api/v1/projects/${id}`
    ),

  create: (data: { name: string; description?: string; templateId?: string }) =>
    apiFetch<Project>('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: { name?: string; description?: string; settings?: Record<string, unknown>; status?: string }) =>
    apiFetch<Project>(`/api/v1/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    apiFetch<{ message: string }>(`/api/v1/projects/${id}`, { method: 'DELETE' }),

  // ─── Integrations (Ship Panel) ─────────────────────────────
  getIntegrations: (id: string) =>
    apiFetch<{
      github?: { connected: boolean; repo?: string; owner?: string; branch?: string; lastPush?: string };
      cloudflare?: { connected: boolean; projectName?: string; accountId?: string; lastDeploy?: string; liveUrl?: string };
    }>(`/api/v1/projects/${id}/integrations`),

  saveIntegrations: (id: string, data: Record<string, unknown>) =>
    apiFetch<{ message: string }>(`/api/v1/projects/${id}/integrations`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  pushToGithub: (id: string, data: { owner: string; repo: string; branch: string; commitMessage: string }) =>
    apiFetch<{ filesCount: number; commitSha: string; url: string }>(
      `/api/v1/projects/${id}/github/push`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  deployToCloudflare: (id: string) =>
    apiFetch<{ url: string; projectName: string }>(
      `/api/v1/projects/${id}/cloudflare/deploy`,
      { method: 'POST' },
    ),

  exportZip: (id: string) =>
    apiFetch<{ downloadUrl: string; sizeBytes: number; filesCount: number }>(
      `/api/v1/projects/${id}/export`,
      { method: 'POST' },
    ),
};

// ─── Files API ──────────────────────────────────────────────
export const filesApi = {
  list: (projectId: string, includeContent = false) =>
    apiFetch<ProjectFile[]>(`/api/v1/files/${projectId}${includeContent ? '?content=true' : ''}`),

  get: (projectId: string, filePath: string) =>
    apiFetch<ProjectFile>(`/api/v1/files/${projectId}/${filePath}`),

  upsert: (projectId: string, data: { path: string; content: string }) =>
    apiFetch<ProjectFile>(`/api/v1/files/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  bulkUpsert: (projectId: string, files: Record<string, string>) =>
    apiFetch<{ updated: number; files: { path: string; created: boolean }[] }>(
      `/api/v1/files/${projectId}/bulk`,
      { method: 'PUT', body: JSON.stringify({ files }) },
    ),

  delete: (projectId: string, filePath: string) =>
    apiFetch<{ message: string }>(`/api/v1/files/${projectId}/${filePath}`, { method: 'DELETE' }),

  rename: (projectId: string, oldPath: string, newPath: string) =>
    apiFetch<{ oldPath: string; newPath: string }>(
      `/api/v1/files/${projectId}/rename`,
      { method: 'POST', body: JSON.stringify({ oldPath, newPath }) },
    ),
};

// ─── Assets API ─────────────────────────────────────────────
export const assetsApi = {
  list: (projectId: string) =>
    apiFetch<ProjectAsset[]>(`/api/v1/assets/${projectId}`),

  upload: async (projectId: string, file: File): Promise<ProjectAsset> => {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${API_BASE}/api/v1/assets/${projectId}/upload`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: formData,
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new ApiError(res.status, json.error?.code || 'UPLOAD_FAILED', json.error?.message || 'Upload failed');
    }
    return json.data;
  },

  getSignedUploadUrl: (projectId: string, data: { filename: string; contentType: string; sizeBytes: number }) =>
    apiFetch<{ uploadUrl: string; gcsKey: string; cdnUrl: string; expiresIn: number }>(
      `/api/v1/assets/${projectId}/upload-url`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  confirmUpload: (projectId: string, data: { gcsKey: string; originalFilename: string; mimeType: string; sizeBytes: number; width?: number; height?: number }) =>
    apiFetch<ProjectAsset>(
      `/api/v1/assets/${projectId}/confirm-upload`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  delete: (projectId: string, assetId: string) =>
    apiFetch<{ message: string }>(`/api/v1/assets/${projectId}/${assetId}`, { method: 'DELETE' }),
};

// ─── AI Chat API — Structured Streaming Protocol ─────────────
export interface AIStreamEvent {
  type: 'stream_start' | 'plan' | 'file_start' | 'file_chunk' | 'file_end' | 'plan_progress' | 'explanation' | 'text_token' | 'stream_end' | 'error' | 'action_start' | 'action_result';
  conversationId?: string;
  items?: string[];
  path?: string;
  content?: string;
  token?: string;
  text?: string;
  completedIndex?: number;
  appliedFiles?: boolean;
  filesPaths?: string[];
  tokensUsed?: number;
  message?: string;
  // Action events (tool use)
  tool?: string;
  input?: Record<string, any>;
  success?: boolean;
  result?: any;
  error?: string;
}

export type AIStreamCallback = (event: AIStreamEvent) => void;

export const aiApi = {
  sendMessage: (data: { projectId: string; conversationId?: string; message: string }) =>
    apiFetch<{ conversationId: string; message: AiMessage & { explanation?: string; plan?: string[]; files?: string[] } }>(
      '/api/v1/ai/chat',
      { method: 'POST', body: JSON.stringify(data) },
    ),

  /**
   * Stream AI response with structured events.
   * The server parses the XML protocol and sends typed SSE events:
   * - stream_start: {conversationId}
   * - plan: {items: string[]}
   * - file_start: {path}
   * - file_chunk: {path, content}
   * - file_end: {path, content} (complete file)
   * - plan_progress: {completedIndex}
   * - explanation: {text}
   * - text_token: {token} (for plain text responses)
   * - stream_end: {conversationId, appliedFiles, filesPaths, tokensUsed}
   * - error: {message}
   */
  streamMessage: async (
    data: { projectId: string; conversationId?: string; message: string },
    onEvent: AIStreamCallback,
  ) => {
    const url = `${API_BASE}/api/v1/ai/chat/stream`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(data),
    });

    if (!res.ok || !res.body) {
      const errJson = await res.json().catch(() => null);
      onEvent({
        type: 'error',
        message: errJson?.error?.message || `AI service error (${res.status})`,
      });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const eventData = line.slice(6).trim();
          if (!eventData || eventData === '[DONE]') continue;
          try {
            const event: AIStreamEvent = JSON.parse(eventData);
            onEvent(event);
          } catch {
            // Skip malformed events
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const eventData = line.slice(6).trim();
          if (!eventData || eventData === '[DONE]') continue;
          try {
            const event: AIStreamEvent = JSON.parse(eventData);
            onEvent(event);
          } catch { /* skip */ }
        }
      }
    }
  },

  getConversations: (projectId: string) =>
    apiFetch<AiConversation[]>(`/api/v1/ai/conversations/${projectId}`),

  getMessages: (projectId: string, conversationId: string) =>
    apiFetch<{ id: string; messages: AiMessage[] }>(
      `/api/v1/ai/conversations/${projectId}/${conversationId}`
    ),
};

// ─── Preview API ────────────────────────────────────────────
export const previewApi = {
  start: (projectId: string) =>
    apiFetch<PreviewSession & { reused: boolean }>(
      '/api/v1/preview/start',
      { method: 'POST', body: JSON.stringify({ projectId }) },
    ),

  update: (sessionId: string, files: Record<string, string>) =>
    apiFetch<{ message: string; filesUpdated: number }>(
      '/api/v1/preview/update',
      { method: 'POST', body: JSON.stringify({ sessionId, files }) },
    ),

  status: (sessionId: string) =>
    apiFetch<PreviewSession>(`/api/v1/preview/status/${sessionId}`),

  stop: (sessionId: string) =>
    apiFetch<{ message: string }>(`/api/v1/preview/stop/${sessionId}`, { method: 'POST' }),

  logs: (sessionId: string) =>
    apiFetch<{ logs: string[] }>(`/api/v1/preview/logs/${sessionId}`),
};

// ─── Build API ──────────────────────────────────────────────
export const buildApi = {
  build: (data: { projectId: string; message?: string }) =>
    apiFetch<{
      versionId: string;
      versionNumber: number;
      files: { path: string; sizeBytes: number; contentHash: string }[];
      totalSizeBytes: number;
      durationMs: number;
      errors: { file: string; message: string; severity: string }[];
      warnings: { file: string; message: string; suggestion: string | null }[];
    }>('/api/v1/build', { method: 'POST', body: JSON.stringify(data) }),

  versions: (projectId: string) =>
    apiFetch<ProjectVersion[]>(`/api/v1/build/${projectId}/versions`),

  restore: (projectId: string, versionId: string) =>
    apiFetch<{ message: string; versionNumber: number; filesRestored: number }>(
      `/api/v1/build/${projectId}/restore`,
      { method: 'POST', body: JSON.stringify({ versionId }) },
    ),
};

// ─── Deploy API ─────────────────────────────────────────────
export const deployApi = {
  deploy: (data: { projectId: string; versionId: string }) =>
    apiFetch<Deployment>(
      '/api/v1/deploy',
      { method: 'POST', body: JSON.stringify(data) },
    ),

  list: (projectId: string) =>
    apiFetch<Deployment[]>(`/api/v1/deploy/${projectId}`),

  rollback: (projectId: string, deploymentId: string) =>
    apiFetch<{ deploymentId: string; rolledBackTo: string; url: string; message: string }>(
      `/api/v1/deploy/${projectId}/rollback`,
      { method: 'POST', body: JSON.stringify({ deploymentId }) },
    ),

  addDomain: (projectId: string, domain: string) =>
    apiFetch<{ id: string; domain: string; sslStatus: string; dnsRecords: unknown[] }>(
      `/api/v1/deploy/${projectId}/domains`,
      { method: 'POST', body: JSON.stringify({ domain }) },
    ),

  verifyDomain: (projectId: string, domainId: string) =>
    apiFetch<{ verified: boolean; cnameVerified: boolean; txtVerified: boolean; message: string }>(
      `/api/v1/deploy/${projectId}/domains/${domainId}/verify`,
      { method: 'POST' },
    ),

  listDomains: (projectId: string) =>
    apiFetch<{ id: string; domain: string; sslStatus: string; dnsVerified: boolean }[]>(
      `/api/v1/deploy/${projectId}/domains`
    ),

  deleteDomain: (projectId: string, domainId: string) =>
    apiFetch<{ message: string }>(`/api/v1/deploy/${projectId}/domains/${domainId}`, { method: 'DELETE' }),
};

// ─── Billing API ────────────────────────────────────────────
export const billingApi = {
  getUsage: () =>
    apiFetch<{
      billingStatus: string;
      paymentMethodAdded: boolean;
      todaySpend: { cents: number; formatted: string };
      monthSpend: { cents: number; formatted: string };
      dailyLimit: { cents: number; formatted: string };
      creditBalance: { cents: number; formatted: string };
      freeTierLimits: {
        ai_messages: number;
        deploys: number;
        storage_mb: number;
        projects: number;
        preview_minutes: number;
        custom_domains: number;
        bandwidth_mb: number;
      } | null;
      usage: {
        projectsCount: number;
        todayAiMessages: number;
        monthAiMessages: number;
        todayDeploys: number;
        monthDeploys: number;
        storageBytes: number;
      };
    }>('/api/v1/billing/usage'),

  createCheckout: (data: { plan: 'pro' | 'business'; interval: 'monthly' | 'yearly' }) =>
    apiFetch<{ checkoutUrl: string; sessionId: string }>(
      '/api/v1/billing/checkout',
      { method: 'POST', body: JSON.stringify(data) },
    ),

  getPortal: () =>
    apiFetch<{ portalUrl: string }>('/api/v1/billing/portal', { method: 'POST' }),

  getSubscription: () =>
    apiFetch<{ plan: string; subscription: { id: string; status: string; currentPeriodEnd: string } | null }>(
      '/api/v1/billing/subscription'
    ),
};
