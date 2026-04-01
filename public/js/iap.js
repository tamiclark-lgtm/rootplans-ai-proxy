/* ============================================================
   RootPlans — iOS In-App Purchase Manager  (LG_IAP)
   ============================================================
   Plugins required in the native Capacitor project:

     npm install @revenuecat/purchases-capacitor \
                 @revenuecat/purchases-capacitor-ui
     npx cap sync ios

   Accessed via the Capacitor bridge at runtime:
     window.Capacitor.Plugins.Purchases       — core SDK
     window.Capacitor.Plugins.RevenueCatUI    — paywall + customer center

   LG.init() calls LG_IAP.init(user.id) automatically on every page.

   Products configured in RevenueCat:
     monthly  — com.rootplans.monthly
     yearly   — com.rootplans.yearly
     lifetime — com.rootplans.lifetime

   Entitlement: "Root Plans Pro"  (identifier: root_plans_pro)
   ============================================================ */
(function () {
  'use strict';

  // ── Config ─────────────────────────────────────────────────────────────────
  // API key is fetched from /api/config at init time.
  // Set REVENUECAT_IOS_PUBLIC_KEY in your Vercel env vars.
  var _rcApiKey = null;

  // Must match the Identifier (not display name) of your entitlement in RC dashboard.
  // Dashboard → Entitlements → "Root Plans Pro" → check the Identifier field.
  var ENTITLEMENT_ID = 'premium';

  // ── Plugin accessors ───────────────────────────────────────────────────────
  function _plugin()   { return window.Capacitor?.Plugins?.Purchases    || null; }
  function _uiPlugin() { return window.Capacitor?.Plugins?.RevenueCatUI || null; }

  // ── Platform helpers ───────────────────────────────────────────────────────
  function isNativeApp() {
    try { return !!window.Capacitor?.isNativePlatform?.(); } catch { return false; }
  }

  function isIOS() {
    try { return window.Capacitor?.getPlatform?.() === 'ios'; } catch { return false; }
  }

  function isAvailable() {
    return isIOS() && !!_plugin();
  }

  // ── Fetch public config from backend ──────────────────────────────────────
  async function _loadApiKey() {
    if (_rcApiKey) return _rcApiKey;
    try {
      var res = await fetch('/api/config');
      var data = await res.json();
      _rcApiKey = data.rcIosApiKey || null;
    } catch (e) {
      console.error('[IAP] could not load config', e);
    }
    return _rcApiKey;
  }

  // ── Configure & login ──────────────────────────────────────────────────────
  async function configure(appUserId) {
    var P = _plugin();
    if (!P) return false;
    var apiKey = await _loadApiKey();
    if (!apiKey) {
      console.error('[IAP] RC API key not available');
      return false;
    }
    try {
      await P.configure({
        apiKey:    apiKey,
        appUserID: appUserId ? String(appUserId) : null,
      });
      return true;
    } catch (e) {
      console.error('[IAP] configure error', e);
      return false;
    }
  }

  async function logIn(appUserId) {
    var P = _plugin();
    if (!P || !appUserId) return null;
    try {
      var result = await P.logIn({ appUserID: String(appUserId) });
      return result?.customerInfo || null;
    } catch (e) {
      console.error('[IAP] logIn error', e);
      return null;
    }
  }

  async function logOut() {
    var P = _plugin();
    if (!P) return;
    try { await P.logOut(); } catch (e) { console.warn('[IAP] logOut error', e); }
  }

  // ── Customer info & entitlement ────────────────────────────────────────────
  async function getCustomerInfo() {
    var P = _plugin();
    if (!P) return null;
    try {
      var result = await P.getCustomerInfo();
      return result?.customerInfo || null;
    } catch { return null; }
  }

  /**
   * Returns true if the user has an active "Root Plans Pro" entitlement.
   */
  async function isEntitled() {
    var info = await getCustomerInfo();
    if (!info) return false;
    var ent = info?.entitlements?.active?.[ENTITLEMENT_ID];
    return ent?.isActive === true;
  }

  /**
   * Returns full entitlement details (expiry, willRenew, product, etc.) or null.
   */
  async function getEntitlement() {
    var info = await getCustomerInfo();
    if (!info) return null;
    return info?.entitlements?.active?.[ENTITLEMENT_ID] || null;
  }

  // ── Offerings (products + prices from App Store) ───────────────────────────
  async function getOfferings() {
    var P = _plugin();
    if (!P) return null;
    try {
      var result = await P.getOfferings();
      return result?.current || null;
    } catch (e) {
      console.error('[IAP] getOfferings error', e);
      return null;
    }
  }

  // ── Direct purchase (for custom UI — prefer presentPaywall instead) ─────────
  async function purchasePackage(pkg) {
    var P = _plugin();
    if (!P) return { ok: false, error: 'IAP not available on this platform' };
    try {
      var result = await P.purchasePackage({ aPackage: pkg });
      await _syncWithBackend();
      return { ok: true, customerInfo: result?.customerInfo };
    } catch (e) {
      if (e?.userCancelled === true || e?.code === 'PURCHASE_CANCELLED') {
        return { ok: false, cancelled: true };
      }
      console.error('[IAP] purchasePackage error', e);
      return { ok: false, error: e?.message || 'Purchase failed' };
    }
  }

  // ── Restore Purchases ──────────────────────────────────────────────────────
  async function restorePurchases() {
    var P = _plugin();
    if (!P) return { ok: false, error: 'IAP not available on this platform' };
    try {
      var result = await P.restorePurchases();
      var customerInfo = result?.customerInfo;
      var entitled = !!(customerInfo?.entitlements?.active?.[ENTITLEMENT_ID]?.isActive);
      if (entitled) await _syncWithBackend();
      return { ok: true, customerInfo: customerInfo, isEntitled: entitled };
    } catch (e) {
      console.error('[IAP] restorePurchases error', e);
      return { ok: false, error: e?.message || 'Restore failed' };
    }
  }

  // ── RevenueCat Paywall UI ──────────────────────────────────────────────────
  // result values: 'PURCHASED' | 'RESTORED' | 'NOT_PRESENTED' | 'CANCELLED' | 'ERROR'

  /**
   * Present the full RevenueCat Paywall (designed in RC dashboard — no code changes needed).
   */
  async function presentPaywall() {
    var UI = _uiPlugin();
    if (!UI) return { result: 'ERROR', error: 'RevenueCatUI plugin not available' };
    try {
      var res = await UI.presentPaywall();
      if (res?.result === 'PURCHASED' || res?.result === 'RESTORED') {
        await _syncWithBackend();
      }
      return res || { result: 'ERROR' };
    } catch (e) {
      console.error('[IAP] presentPaywall error', e);
      return { result: 'ERROR', error: e?.message };
    }
  }

  /**
   * Present the paywall ONLY if the user doesn't already have "Root Plans Pro".
   * Best used on gated screens (e.g. create.html) as a soft gate.
   */
  async function presentPaywallIfNeeded() {
    var UI = _uiPlugin();
    if (!UI) return { result: 'ERROR', error: 'RevenueCatUI plugin not available' };
    try {
      var res = await UI.presentPaywallIfNeeded({
        requiredEntitlementIdentifier: ENTITLEMENT_ID,
      });
      if (res?.result === 'PURCHASED' || res?.result === 'RESTORED') {
        await _syncWithBackend();
      }
      return res || { result: 'ERROR' };
    } catch (e) {
      console.error('[IAP] presentPaywallIfNeeded error', e);
      return { result: 'ERROR', error: e?.message };
    }
  }

  // ── Customer Center ────────────────────────────────────────────────────────
  /**
   * Present RevenueCat Customer Center — lets users manage, cancel, or restore
   * their subscription and contact support, all without leaving the app.
   */
  async function presentCustomerCenter() {
    var UI = _uiPlugin();
    if (!UI) {
      console.warn('[IAP] RevenueCatUI not available — falling back to restorePurchases');
      return restorePurchases();
    }
    try {
      await UI.presentCustomerCenter();
      // Re-sync after dismissal in case user restored inside Customer Center
      await _syncWithBackend();
      return { ok: true };
    } catch (e) {
      console.error('[IAP] presentCustomerCenter error', e);
      return { ok: false, error: e?.message };
    }
  }

  // ── Backend sync ───────────────────────────────────────────────────────────
  async function _syncWithBackend() {
    // Support both RP (rp-auth.js) and LG (auth.js) session managers
    var apiFetch = (typeof RP !== 'undefined' && RP.apiFetch)
      ? RP.apiFetch.bind(RP)
      : (typeof LG !== 'undefined' && LG.apiFetch)
        ? LG.apiFetch.bind(LG)
        : null;
    if (!apiFetch) {
      console.warn('[IAP] _syncWithBackend: no session manager available (RP/LG)');
      return;
    }
    try {
      var res = await apiFetch('/api/apple/verify', { method: 'POST' });
      if (!res.ok) console.warn('[IAP] backend sync error', res.data);
      else console.log('[IAP] backend sync ok — isPremium:', res.data?.active);
    } catch (e) {
      console.warn('[IAP] backend sync network error', e);
    }
  }

  async function syncWithBackend() { return _syncWithBackend(); }

  // ── Init (called automatically by LG.init() after login) ──────────────────
  async function init(userId) {
    if (!isAvailable()) return false;
    var ok = await configure(userId);
    if (ok && userId) await logIn(userId);
    return ok;
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  window.LG_IAP = {
    isNativeApp:            isNativeApp,
    isIOS:                  isIOS,
    isAvailable:            isAvailable,
    init:                   init,
    configure:              configure,
    logIn:                  logIn,
    logOut:                 logOut,
    getCustomerInfo:        getCustomerInfo,
    isEntitled:             isEntitled,
    getEntitlement:         getEntitlement,
    getOfferings:           getOfferings,
    purchasePackage:        purchasePackage,
    restorePurchases:       restorePurchases,
    presentPaywall:         presentPaywall,
    presentPaywallIfNeeded: presentPaywallIfNeeded,
    presentCustomerCenter:  presentCustomerCenter,
    syncWithBackend:        syncWithBackend,
  };
})();
