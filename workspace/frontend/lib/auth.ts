import { API_URL } from './config';

const STORAGE_KEYS = {
  accessToken: 'oa_access_token',
  refreshToken: 'oa_refresh_token',
  userEmail: 'oa_user_email',
  displayName: 'oa_display_name',
} as const;

export interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  userEmail: string | null;
  displayName: string | null;
}

export function getStoredAuth(): AuthState {
  if (typeof window === 'undefined') {
    return { accessToken: null, refreshToken: null, userEmail: null, displayName: null };
  }
  return {
    accessToken: localStorage.getItem(STORAGE_KEYS.accessToken),
    refreshToken: localStorage.getItem(STORAGE_KEYS.refreshToken),
    userEmail: localStorage.getItem(STORAGE_KEYS.userEmail),
    displayName: localStorage.getItem(STORAGE_KEYS.displayName),
  };
}

export function storeAuth(data: {
  access_token: string;
  refresh_token: string;
  user: { email: string; display_name: string };
}) {
  localStorage.setItem(STORAGE_KEYS.accessToken, data.access_token);
  localStorage.setItem(STORAGE_KEYS.refreshToken, data.refresh_token);
  localStorage.setItem(STORAGE_KEYS.userEmail, data.user.email);
  localStorage.setItem(STORAGE_KEYS.displayName, data.user.display_name);
}

export function clearAuth() {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
}

/**
 * Email/password login is disabled — the backend doesn't expose `/v1/auth/login`
 * or `/v1/auth/refresh`. Use Firebase Sign-In via OpenAgentsAuthProvider, or
 * the workspace_token mode via createWorkspaceLocal().
 *
 * These stubs exist so legacy callers don't crash; they throw / return null
 * loudly enough that any UI still wired to email login will surface an error.
 */
export async function login(_email: string, _password: string): Promise<AuthState> {
  void _email;
  void _password;
  void API_URL; // keep import live for now in case callers re-enable
  throw new Error(
    'Email/password login is disabled — sign in with Google via OpenAgentsAuthProvider.',
  );
}

export async function refreshAccessToken(): Promise<string | null> {
  // No `/v1/auth/refresh` endpoint exists on the backend. Refresh tokens are
  // only meaningful for the email/password flow which is currently disabled.
  return null;
}
