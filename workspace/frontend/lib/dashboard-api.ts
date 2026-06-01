import { getStoredAuth, refreshAccessToken } from './auth';
import { API_URL } from './config';

export interface WorkspaceSummary {
  workspaceId: string;
  slug: string;
  name: string;
  status: string;
  token: string;
  agentCount: number;
  createdAt: string | null;
  lastActivityAt: string | null;
}

export interface PaginatedWorkspaces {
  items: WorkspaceSummary[];
  pagination: {
    page: number;
    page_size: number;
    total: number | null;
    total_pages: number | null;
    has_next: boolean;
    has_prev: boolean;
  };
}

async function authFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { accessToken } = getStoredAuth();

  const doFetch = async (token: string) =>
    fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

  let res = await doFetch(accessToken!);

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (!newToken) throw new Error('Session expired');
    res = await doFetch(newToken);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || body?.detail || `API error (${res.status})`);
  }

  const json = await res.json();
  return json.data;
}

/**
 * Dashboard / workspace listing helpers.
 *
 * Note: the backend currently has no `/v1/auth/*` or `/v1/ws` endpoints — only
 * `/v1/workspaces`. So `listMyWorkspaces` returns an empty page (no per-user
 * workspace registry exists yet) and `createWorkspace` delegates to
 * `createWorkspaceLocal` which actually works.
 */
export async function listMyWorkspaces(
  _page = 1,
  _pageSize = 50,
  _status?: string,
): Promise<PaginatedWorkspaces> {
  void _page;
  void _pageSize;
  void _status;
  return {
    items: [],
    pagination: {
      page: 1,
      page_size: 50,
      total: 0,
      total_pages: 1,
      has_next: false,
      has_prev: false,
    },
  };
}

export async function createWorkspace(
  agentName: string,
  name?: string,
): Promise<{
  workspaceId: string;
  slug: string;
  name: string;
  token: string;
  url: string;
}> {
  // Delegate to the unauthenticated POST /v1/workspaces endpoint — the only
  // workspace-creation path the backend actually exposes today.
  return createWorkspaceLocal(agentName, name);
}

/**
 * Creates a workspace without Firebase auth — for local/workspace_token mode.
 * Calls the backend POST /v1/workspaces endpoint directly.
 */
export async function createWorkspaceLocal(
  agentName?: string,
  name?: string,
): Promise<{
  workspaceId: string;
  slug: string;
  name: string;
  token: string;
  url: string;
}> {
  const res = await fetch(`${API_URL}/v1/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_name: agentName || 'default',
      name: name || undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || body?.detail || `API error (${res.status})`);
  }

  const json = await res.json();
  // Backend may return data directly or nested under .data
  return json.data || json;
}
