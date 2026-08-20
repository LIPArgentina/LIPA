window.APP_CONFIG = (() => {
  const host = String(location.hostname || '').toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const isStaging = host.includes('staging');

  return {
    API_BASE_URL: isLocal
      ? 'http://localhost:3000'
      : (isStaging
          ? 'https://liga-backend-staging.onrender.com'
          : 'https://liga-backend-tt82.onrender.com')
  };
})();

(() => {
  'use strict';

  const API_BASE = String(window.APP_CONFIG?.API_BASE_URL || '').replace(/\/+$/, '');
  const nativeFetch = window.fetch.bind(window);
  const SESSION_KEYS = ['lpi.session', 'lpi_team_session'];
  const REFRESH_MARGIN_MS = 5 * 60 * 1000;
  let refreshPromise = null;
  let redirecting = false;

  function readSession() {
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of SESSION_KEYS) {
        try {
          const raw = storage.getItem(key);
          if (!raw) continue;
          const session = JSON.parse(raw);
          if (session?.token) return session;
        } catch (_) {}
      }
    }
    return null;
  }

  function writeSession(session) {
    if (!session) return;
    try { localStorage.setItem('lpi.session', JSON.stringify(session)); } catch (_) {}
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of SESSION_KEYS) {
        try {
          if (storage.getItem(key)) storage.setItem(key, JSON.stringify(session));
        } catch (_) {}
      }
    }
    window.dispatchEvent(new CustomEvent('lpi:session-updated', { detail: session }));
  }

  function clearSession() {
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of SESSION_KEYS) {
        try { storage.removeItem(key); } catch (_) {}
      }
    }
  }

  function tokenExpiresSoon(token) {
    try {
      const encoded = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      const payload = JSON.parse(atob(padded));
      return !payload.exp || payload.exp * 1000 <= Date.now() + REFRESH_MARGIN_MS;
    } catch (_) {
      return true;
    }
  }

  function isApiUrl(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      const url = new URL(raw, window.location.href);
      return !!API_BASE && url.href.startsWith(`${API_BASE}/`);
    } catch (_) {
      return false;
    }
  }

  function isAuthUrl(input) {
    try {
      const raw = typeof input === 'string' ? input : input?.url;
      const pathname = new URL(raw, window.location.href).pathname;
      return /\/(admin|team|sala)\/login$/.test(pathname)
        || /\/auth\/refresh$/.test(pathname)
        || /\/logout$/.test(pathname);
    } catch (_) {
      return false;
    }
  }

  function requestOptions(input, init, token) {
    const baseHeaders = input instanceof Request ? input.headers : undefined;
    const headers = new Headers(baseHeaders || {});
    new Headers(init?.headers || {}).forEach((value, key) => headers.set(key, value));
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return {
      ...(init || {}),
      credentials: init?.credentials || 'include',
      headers,
    };
  }

  async function renewSession(session = readSession()) {
    if (!session?.refreshToken) return null;
    if (!refreshPromise) {
      refreshPromise = nativeFetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      }).then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json().catch(() => ({}));
        if (!data?.token) return null;
        const updated = {
          ...session,
          token: data.token,
          refreshToken: data.refreshToken || session.refreshToken,
          sessionExpiresAt: data.sessionExpiresAt || session.sessionExpiresAt,
          ts: Date.now(),
        };
        writeSession(updated);
        return updated;
      }).catch(() => null).finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  function restoreAdminBackup() {
    try {
      const raw = localStorage.getItem('lpi.admin.session.backup');
      if (!raw) return null;
      const backup = JSON.parse(raw);
      if (!backup?.token) return null;
      writeSession(backup);
      localStorage.removeItem('lpi.admin.session.backup');
      return backup;
    } catch (_) {
      return null;
    }
  }

  function goToLogin() {
    if (redirecting || /\/auth\/login\.html$/i.test(location.pathname)) return;
    redirecting = true;
    const returnPath = `${location.pathname}${location.search}${location.hash}`;
    try { sessionStorage.setItem('lpi.auth.returnUrl', returnPath); } catch (_) {}
    clearSession();
    const params = new URLSearchParams({ reason: 'expired', return: returnPath });
    location.assign(`/auth/login.html?${params.toString()}`);
  }

  window.fetch = async function lpiAuthenticatedFetch(input, init = {}) {
    if (!isApiUrl(input) || isAuthUrl(input)) return nativeFetch(input, init);

    let session = readSession();
    if (session?.refreshToken && tokenExpiresSoon(session.token)) {
      session = await renewSession(session) || session;
    }

    const retryInput = input instanceof Request ? input.clone() : input;
    let response = await nativeFetch(input, requestOptions(input, init, session?.token));
    if (response.status !== 401 || !session) return response;

    let renewed = await renewSession(session);
    if (!renewed && session.isTestSession) {
      const backup = restoreAdminBackup();
      renewed = backup?.refreshToken ? (await renewSession(backup) || backup) : backup;
    }
    if (renewed) {
      response = await nativeFetch(retryInput, requestOptions(retryInput, init, renewed.token));
      if (response.status !== 401) return response;
    }

    goToLogin();
    return response;
  };

  window.LPI_AUTH = {
    readSession,
    renew: () => renewSession(readSession()),
    async logout({ redirect = false } = {}) {
      const session = readSession();
      try {
        await nativeFetch(`${API_BASE}/api/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session?.refreshToken || '' }),
        });
      } catch (_) {}
      clearSession();
      if (redirect) location.assign('/index.html');
    },
  };
})();
