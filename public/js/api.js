import { auth } from './firebase-config.js';

const BASE_URL = '/api';

/**
 * Wraps fetch() to automatically attach the current user's Firebase ID
 * token as a Bearer token, and to throw on non-2xx responses so callers
 * can just use try/catch.
 */
export async function api(path, { method = 'GET', body = null } = {}) {
  const user = auth.currentUser;
  const headers = { 'Content-Type': 'application/json' };

  if (user) {
    const token = await user.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // The backend returns errors in two shapes:
    //   - { error: "some message" }                 (most routes)
    //   - { errors: [{ msg: "...", path: "..." }] }  (express-validator, on 400s)
    // The old code only checked `data.error`, so any express-validator
    // failure fell through to the generic "Request failed with status
    // 400" text instead of telling you which field was wrong.
    let message = data.error;
    if (!message && Array.isArray(data.errors) && data.errors.length) {
      message = data.errors
        .map((e) => (e.path ? `${e.path}: ${e.msg}` : e.msg))
        .join(' · ');
    }
    throw new Error(message || `Request failed with status ${res.status}`);
  }

  return data;
}

/** Redirects to /login.html if no user is signed in. Call at the top of protected pages. */
export function requireLogin(onUser) {
  return new Promise((resolve) => {
    const unsub = auth.onAuthStateChanged((user) => {
      unsub();
      if (!user) {
        window.location.href = '/login.html';
        return;
      }
      if (onUser) onUser(user);
      resolve(user);
    });
  });
}

export function showToast(message, isError = false) {
  const el = document.createElement('div');
  el.textContent = message;
  el.className = `fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-white z-50 ${
    isError ? 'bg-red-600' : 'bg-green-600'
  }`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
