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

// ─── AI Chat API ────────────────────────────────────────────
export const aiApi = {
  sendMessage: (data: { projectId: string; conversationId?: string; message: string }) =>
    apiFetch<{ conversationId: string; message: AiMessage }>(
      '/api/v1/ai/chat',
      { method: 'POST', body: JSON.stringify(data) },
    ),

  streamMessage: async (
    data: { projectId: string; conversationId?: string; message: string },
    onToken: (token: string) => void,
    onComplete: (meta?: { conversationId?: string; appliedFiles?: boolean }) => void,
    onError: (error: string) => void,
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
      onError(errJson?.error?.message || 'Failed to connect to AI service.');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let meta: { conversationId?: string; appliedFiles?: boolean } = {};

    // Get conversationId from response header
    const headerConvId = res.headers.get('X-Conversation-Id');
    if (headerConvId && headerConvId !== 'new') {
      meta.conversationId = headerConvId;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const eventData = line.slice(6).trim();
          if (eventData === '[DONE]') {
            continue; // Wait for our custom sbp_done event
          }
          try {
            const parsed = JSON.parse(eventData);
            // Handle content streaming from Anthropic
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              onToken(parsed.delta.text);
            }
            // Handle our custom completion event with metadata
            else if (parsed.type === 'sbp_done') {
              meta.conversationId = parsed.conversationId || meta.conversationId;
              meta.appliedFiles = parsed.appliedFiles;
            }
          } catch {
            // Skip malformed SSE events
          }
        }
      }
    }

    onComplete(meta);
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
      plan: string;
      aiTokensUsed: number;
      aiTokensLimit: number;
      deploysUsed: number;
      deploysLimit: number;
      storageUsedBytes: number;
      storageLimitBytes: number;
      projectsCount: number;
      projectsLimit: number;
      customDomainsLimit: number;
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
