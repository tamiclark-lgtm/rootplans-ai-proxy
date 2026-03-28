/* ============================================================
   RootPlans — Auth & Session Utility  (window.RP)
   Completely separate from Little Gem (lg_session / LG).
   ============================================================ */
(function () {
  'use strict';

  const SESSION_KEY = 'rp_session';

  // ── SESSION STORAGE ────────────────────────────────────────────────────────
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  function setSession(data) { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); }
  function clearSession()   { localStorage.removeItem(SESSION_KEY); }
  function isLoggedIn()     { return !!getSession()?.token; }

  // ── PLATFORM ───────────────────────────────────────────────────────────────
  function isNativeIOS() {
    try {
      return window.Capacitor?.getPlatform?.() === 'ios' &&
             !!window.Capacitor?.isNativePlatform?.();
    } catch { return false; }
  }

  // ── API HELPER ─────────────────────────────────────────────────────────────
  function authHeaders() {
    const s = getSession();
    return s?.token
      ? { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' };
  }

  async function apiFetch(path, opts = {}) {
    const r    = await fetch(path, { headers: authHeaders(), ...opts });
    const json = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: json };
  }

  // ── SESSION VALIDATION ─────────────────────────────────────────────────────
  async function validateSession() {
    const s = getSession();
    if (!s?.token) return null;
    try {
      const { ok, data } = await apiFetch('/api/auth/me');
      if (!ok) { clearSession(); return null; }
      setSession({ ...s, user: data.user, subscription: data.subscription });
      return data;
    } catch { return null; }
  }

  // ── AUTH ACTIONS ───────────────────────────────────────────────────────────
  async function signup(name, email, password, confirmPassword) {
    const { ok, data } = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, confirmPassword }),
    });
    if (ok) setSession(data);
    return { ok, data };
  }

  async function login(email, password) {
    const { ok, data } = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (ok) setSession(data);
    return { ok, data };
  }

  async function logout() {
    const s = getSession();
    if (s?.token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + s.token },
        });
      } catch { /* ignore */ }
    }
    clearSession();
    window.location.href = '/rp-login.html';
  }

  // ── ENTITLEMENT ────────────────────────────────────────────────────────────
  function getEntitlement() {
    return getSession()?.subscription || null;
  }

  function isPremium() {
    const ent = getEntitlement();
    return !!ent?.isPremium;
  }

  function getPlanLimit() {
    return getEntitlement()?.planLimit || 1;
  }

  function requirePremium(featureName) {
    if (isPremium()) return true;
    if (isNativeIOS() && window.LG_IAP) {
      window.LG_IAP.presentPaywallIfNeeded();
    } else {
      window.location.href = '/rp-pricing.html?upgrade=1&feature=' + (featureName || '');
    }
    return false;
  }

  // ── ROUTE GUARDS ───────────────────────────────────────────────────────────
  function requireAuth() {
    if (!isLoggedIn()) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = '/rp-login.html?next=' + next;
      return false;
    }
    return true;
  }

  // ── INIT ───────────────────────────────────────────────────────────────────
  async function init() {
    const s = getSession();
    let user         = s?.user         || null;
    let subscription = s?.subscription || null;

    if (s?.token) {
      const data = await validateSession();
      if (data) {
        user         = data.user;
        subscription = data.subscription;
      } else {
        user = null; subscription = null;
      }
    }

    window.RP.user         = user;
    window.RP.subscription = subscription;

    if (isNativeIOS() && window.LG_IAP && user) {
      window.LG_IAP.init(user.id).catch(() => {});
    }

    return { user, subscription };
  }

  // ── EXPORT ─────────────────────────────────────────────────────────────────
  window.RP = {
    user: null, subscription: null,
    // Session
    getSession, setSession, clearSession, isLoggedIn,
    // Entitlement
    getEntitlement, isPremium, getPlanLimit, requirePremium,
    // Auth
    signup, login, logout,
    // Navigation
    requireAuth, init,
    // Platform
    isNativeIOS,
    // Utils
    authHeaders, apiFetch,
  };
})();
