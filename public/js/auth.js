/* ============================================================
   Little Gem — Auth & Session Utility
   Loaded on every page. Sets window.LG.
   ============================================================ */
(function () {
  'use strict';

  const SESSION_KEY = 'lg_session';

  // ── SESSION STORAGE ────────────────────────────────────────────────────────
  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  function setSession(data) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  }
  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
  }
  function isLoggedIn() {
    return !!getSession()?.token;
  }

  // ── API HELPER ─────────────────────────────────────────────────────────────
  function authHeaders() {
    const s = getSession();
    return s?.token ? { Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  async function apiFetch(path, opts = {}) {
    const r = await fetch(path, { headers: authHeaders(), ...opts });
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
      } catch { /* ignore network errors on logout */ }
    }
    clearSession();
    window.location.href = '/';
  }

  // ── PLATFORM DETECTION ─────────────────────────────────────────────────────
  function isNativeIOS() {
    try {
      return window.Capacitor?.getPlatform?.() === 'ios' &&
             !!window.Capacitor?.isNativePlatform?.();
    } catch { return false; }
  }

  // ── SUBSCRIPTION ───────────────────────────────────────────────────────────
  function canAccessCreator() {
    const s = getSession();
    const sub = s?.subscription;
    if (!sub) return false;
    const now = new Date();
    // Apple IAP subscriptions come back with source:'apple', status:'active'
    if (sub.source === 'apple') {
      return sub.status === 'active' &&
             (!sub.renewalDate || new Date(sub.renewalDate) > now);
    }
    // Stripe subscriptions
    return (
      sub.status === 'trialing' ||
      sub.status === 'active' ||
      (sub.status === 'canceled' && sub.renewalDate && new Date(sub.renewalDate) > now)
    );
  }

  async function startCheckout(plan) {
    const { ok, data } = await apiFetch('/api/subscription/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
    if (ok && data.url) { window.location.href = data.url; return true; }
    return { ok, data };
  }

  async function openBillingPortal() {
    const { ok, data } = await apiFetch('/api/subscription/portal', { method: 'POST' });
    if (ok && data.url) { window.location.href = data.url; return true; }
    return { ok, data };
  }

  // ── ROUTE GUARDS ───────────────────────────────────────────────────────────
  /** Redirect to signup if not authenticated, preserving intended destination */
  function requireAuth() {
    if (!isLoggedIn()) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = '/signup.html?next=' + next;
      return false;
    }
    return true;
  }

  /** Redirect to pricing if no active subscription */
  function requireSubscription() {
    if (!canAccessCreator()) {
      window.location.href = '/pricing.html';
      return false;
    }
    return true;
  }

  /** Smart CTA: Create Your Book */
  function goToCreate(e) {
    if (e) e.preventDefault();
    if (!isLoggedIn()) {
      window.location.href = '/signup.html?next=/create.html';
    } else if (!canAccessCreator()) {
      window.location.href = '/pricing.html';
    } else {
      window.location.href = '/create.html';
    }
  }

  // ── NAV UPDATE ─────────────────────────────────────────────────────────────
  function updateNav(user) {
    const el = document.getElementById('navAuth');
    if (!el) return;
    if (user) {
      const firstName = (user.name || '').split(' ')[0];
      el.innerHTML =
        '<a href="/library.html" class="nav-link">My Books</a>' +
        '<a href="/account.html" class="nav-link">' + escHtml(firstName) + '</a>' +
        '<button class="btn btn-ghost btn-sm" onclick="LG.logout()">Sign Out</button>';
    } else {
      el.innerHTML =
        '<a href="/login.html" class="nav-link">Sign In</a>' +
        '<a href="/signup.html" class="btn btn-primary btn-sm" onclick="LG.goToCreate(event)">Create Your Book</a>';
    }
  }

  function escHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // ── INIT ───────────────────────────────────────────────────────────────────
  /**
   * Call on every page load. Validates session, updates nav.
   * Returns { user, subscription } or { user: null, subscription: null }
   */
  async function init() {
    const s = getSession();
    let user = s?.user || null;
    let subscription = s?.subscription || null;

    if (s?.token) {
      const data = await validateSession();
      if (data) {
        user = data.user;
        subscription = data.subscription;
      } else {
        user = null;
        subscription = null;
      }
    }

    updateNav(user);
    // Store on LG for page scripts to access
    window.LG.user = user;
    window.LG.subscription = subscription;

    // Initialise RevenueCat IAP on iOS once we know the user ID
    if (isNativeIOS() && window.LG_IAP && user) {
      window.LG_IAP.init(user.id).catch(() => {});
    }

    return { user, subscription };
  }

  // ── MOBILE NAV TOGGLE ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    const toggle = document.getElementById('navToggle');
    const links  = document.querySelector('.nav-links');
    const auth   = document.querySelector('.nav-auth');
    if (toggle && links) {
      toggle.addEventListener('click', function () {
        links.classList.toggle('open');
        if (auth) auth.classList.toggle('open');
      });
    }
  });

  // ── EXPORT ─────────────────────────────────────────────────────────────────
  window.LG = {
    // State (populated after init)
    user: null,
    subscription: null,
    // Session
    getSession,
    setSession,
    clearSession,
    isLoggedIn,
    // Actions
    signup,
    login,
    logout,
    startCheckout,
    openBillingPortal,
    canAccessCreator,
    // Navigation
    requireAuth,
    requireSubscription,
    goToCreate,
    init,
    // Utils
    authHeaders,
    apiFetch,
    // Platform
    isNativeIOS,
  };
})();
