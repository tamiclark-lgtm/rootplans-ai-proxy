/* ============================================================
   RootPlans — Auth & Session Utility  (window.LG)
   Loaded on every page.
   ============================================================ */
(function () {
  'use strict';

  const SESSION_KEY = 'lg_session';

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
    window.location.href = '/';
  }

  // ── ENTITLEMENT ────────────────────────────────────────────────────────────
  // The server returns:
  //   { planTier, subscriptionStatus, subscriptionSource, planLimit, isPremium }
  // stored under session.subscription for backward compatibility.

  function getEntitlement() {
    return getSession()?.subscription || null;
  }

  function isPremium() {
    const ent = getEntitlement();
    return !!ent?.isPremium;
  }

  /** True if user can access the app at all (free tier always can). */
  function canAccessCreator() {
    return isLoggedIn();
  }

  /** True if the named premium feature is unlocked. */
  function canAccess(feature) {
    if (isPremium()) return true;
    const freeFeatures = ['basicAI', 'basicPlan'];
    return freeFeatures.includes(feature);
  }

  function getPlanLimit() {
    return getEntitlement()?.planLimit || 1;
  }

  // ── PAYWALL TRIGGER (web) ──────────────────────────────────────────────────
  function requirePremium(featureName) {
    if (isPremium()) return true;
    // On iOS show the native paywall; on web redirect to pricing
    if (isNativeIOS() && window.LG_IAP) {
      window.LG_IAP.presentPaywallIfNeeded();
    } else {
      window.location.href = '/pricing.html?upgrade=1&feature=' + (featureName || '');
    }
    return false;
  }

  // ── ROUTE GUARDS ───────────────────────────────────────────────────────────
  function requireAuth() {
    if (!isLoggedIn()) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = '/signup.html?next=' + next;
      return false;
    }
    return true;
  }

  function requireSubscription() {
    if (!canAccessCreator()) {
      window.location.href = '/pricing.html';
      return false;
    }
    return true;
  }

  function goToCreate(e) {
    if (e) e.preventDefault();
    if (!isLoggedIn()) {
      window.location.href = '/signup.html?next=/create.html';
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
        '<a href="/account.html" class="nav-link">' + escHtml(firstName) + '</a>' +
        '<button class="btn btn-ghost btn-sm" onclick="LG.logout()">Sign Out</button>';
    } else {
      el.innerHTML =
        '<a href="/login.html" class="nav-link">Sign In</a>' +
        '<a href="/signup.html" class="btn btn-primary btn-sm">Get Started</a>';
    }
  }

  function escHtml(str) {
    return String(str).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
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

    updateNav(user);
    window.LG.user         = user;
    window.LG.subscription = subscription;
    window.LG.entitlement  = subscription; // alias

    // Initialise RevenueCat IAP on iOS once we know the user
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
    user: null, subscription: null, entitlement: null,
    // Session
    getSession, setSession, clearSession, isLoggedIn,
    // Entitlement
    getEntitlement, isPremium, canAccess, canAccessCreator, getPlanLimit, requirePremium,
    // Auth
    signup, login, logout,
    // Navigation
    requireAuth, requireSubscription, goToCreate, init,
    // Platform
    isNativeIOS,
    // Utils
    authHeaders, apiFetch,
  };
})();
