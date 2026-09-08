'use client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api/v1';

// In-memory only — never localStorage, to limit XSS exposure. Lost on a
// full page reload; auth-context.js re-hydrates it via a silent
// /auth/refresh call on mount (the refresh token itself lives in an
// httpOnly cookie the browser manages automatically).
let accessToken = null;

function setAccessToken(token) {
  accessToken = token;
}

function getAccessToken() {
  return accessToken;
}

/**
 * Fetch wrapper for the API. Always sends credentials (so the
 * `refresh_token` httpOnly cookie flows both ways), attaches the
 * in-memory access token, and on a 401 tries exactly one silent
 * `/auth/refresh` + retry before surfacing the failure to the caller.
 *
 * @param {string} path e.g. "/auth/login" (relative to API_BASE_URL)
 * @param {RequestInit} [options]
 * @param {boolean} [isRetry] internal — prevents infinite refresh loops
 */
async function apiFetch(path, options = {}, isRetry = false) {
  // FormData bodies (document upload) must NOT get an explicit
  // content-type — the browser sets multipart/form-data with the
  // correct boundary itself; forcing application/json here would break
  // the upload entirely.
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'content-type': 'application/json' }),
    ...(options.headers || {}),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !isRetry && path !== '/auth/refresh') {
    const refreshed = await tryRefresh();
    if (refreshed) return apiFetch(path, options, true);
  }

  return res;
}

async function tryRefresh() {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) {
      setAccessToken(null);
      return false;
    }
    const data = await res.json();
    setAccessToken(data.accessToken);
    return true;
  } catch {
    setAccessToken(null);
    return false;
  }
}

/**
 * Convenience wrapper: parses JSON and throws a normalized error on a
 * non-2xx response, so callers can `try { await apiJson(...) } catch (err) { err.code / err.message }`.
 */
async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

/**
 * For file downloads (GET .../download) — returns the blob plus the
 * filename the server suggested via Content-Disposition, or throws the
 * same normalized error shape as apiJson on a non-2xx response (the API
 * still returns JSON error bodies for those, e.g. 409 INTEGRITY_FAILURE).
 */
async function apiBlob(path) {
  const res = await apiFetch(path);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data?.error?.code;
    throw err;
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : 'download';
  const blob = await res.blob();
  return { blob, filename, integrityStatus: res.headers.get('x-integrity-status') };
}

export { apiFetch, apiJson, apiBlob, setAccessToken, getAccessToken, tryRefresh, API_BASE_URL };
