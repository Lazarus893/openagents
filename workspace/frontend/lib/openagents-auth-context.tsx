'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { capture, identify } from './analytics';

interface OpenAgentsUser {
  email: string;
  displayName: string;
  photoURL: string | null;
}

interface OpenAgentsAuthContextValue {
  user: OpenAgentsUser | null;
  idToken: string | null;
  loading: boolean;
  isOpenAgentsDomain: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Hostnames where the OpenAgents Firebase Sign-In button is enabled.
 *
 * Comma-separated list from `NEXT_PUBLIC_AUTH_HOSTS`. Entries starting with
 * `*.` are suffix wildcards (e.g. `*.vercel.app` matches every preview domain).
 * Falls back to the canonical prod host + localhost + the current production
 * Vercel alias.
 */
const RAW_HOSTS =
  process.env.NEXT_PUBLIC_AUTH_HOSTS ??
  'workspace.openagents.org,localhost,frontend-two-flax-61.vercel.app,*.vercel.app';
const OPENAGENTS_HOSTNAMES = RAW_HOSTS.split(',')
  .map((h) => h.trim())
  .filter(Boolean);

function isOpenAgentsHost(hostname: string): boolean {
  return OPENAGENTS_HOSTNAMES.some((entry) => {
    if (entry.startsWith('*.')) {
      // '*.vercel.app' → match anything ending with '.vercel.app'
      return hostname.endsWith(entry.slice(1));
    }
    return hostname === entry;
  });
}

const OpenAgentsAuthContext = createContext<OpenAgentsAuthContextValue | null>(null);

export function useOpenAgentsAuth() {
  const ctx = useContext(OpenAgentsAuthContext);
  if (!ctx) throw new Error('useOpenAgentsAuth must be used within OpenAgentsAuthProvider');
  return ctx;
}

export function OpenAgentsAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<OpenAgentsUser | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOpenAgentsDomain, setIsOpenAgentsDomain] = useState(false);

  useEffect(() => {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const isDomain = isOpenAgentsHost(hostname);
    setIsOpenAgentsDomain(isDomain);

    if (!isDomain) {
      setLoading(false);
      return;
    }

    // Dynamically import firebase to avoid loading it on non-openagents domains
    let unsubscribe: (() => void) | undefined;

    import('./firebase').then(({ onAuthChange, getIdToken }) => {
      unsubscribe = onAuthChange(async (firebaseUser) => {
        if (firebaseUser) {
          const token = await getIdToken();
          setUser({
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || firebaseUser.email || '',
            photoURL: firebaseUser.photoURL,
          });
          setIdToken(token);
        } else {
          setUser(null);
          setIdToken(null);
        }
        setLoading(false);
      });
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async () => {
    const { signInWithGoogle, getIdToken } = await import('./firebase');
    const firebaseUser = await signInWithGoogle();
    const token = await getIdToken();
    const email = firebaseUser.email || '';
    setUser({
      email,
      displayName: firebaseUser.displayName || email,
      photoURL: firebaseUser.photoURL,
    });
    setIdToken(token);
    if (email) identify(email, { display_name: firebaseUser.displayName || email });
    capture('sign_in', { method: 'google' });
  }, []);

  const signOut = useCallback(async () => {
    const { signOutUser } = await import('./firebase');
    await signOutUser();
    setUser(null);
    setIdToken(null);
  }, []);

  return (
    <OpenAgentsAuthContext.Provider value={{ user, idToken, loading, isOpenAgentsDomain, signIn, signOut }}>
      {children}
    </OpenAgentsAuthContext.Provider>
  );
}
