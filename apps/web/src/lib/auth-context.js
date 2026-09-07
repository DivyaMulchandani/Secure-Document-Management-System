'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiJson, setAccessToken, getAccessToken } from './api-client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Access tokens are in-memory only and don't survive a full page
  // reload — silently try to re-hydrate the session from the httpOnly
  // refresh cookie on mount.
  useEffect(() => {
    (async () => {
      try {
        const data = await apiJson('/auth/refresh', { method: 'POST' });
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        setAccessToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username, password, otp) => {
    const data = await apiJson('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, ...(otp ? { otp } : {}) }),
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiJson('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, accessToken: getAccessToken(), loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
