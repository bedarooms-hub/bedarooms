// Hybrid storage: Supabase (cloud) + localStorage (offline cache)
// - If VITE_SUPABASE_URL/KEY are set and user is logged in → cloud is primary, localStorage is cache/mirror
// - If not configured or not logged in → localStorage only (original behavior)
// - App keeps calling window.storage.get/set — no App.jsx shape change needed (except auth UI)
// Adds: window.storage.getSession(), signIn, signUp, signOut, getUser helpers

import { supabase, isSupabaseConfigured } from "./supabase.js";

const PREFIX = "rlm:";

function fullKey(key, shared) {
  return `${PREFIX}${shared ? "shared" : "user"}:${key}`;
}
function isQuotaError(e) {
  return e && (e.name === "QuotaExceededError" || e.code === 22 || e.code === 1014);
}

// Map App.jsx STORAGE_KEY ("rental-data") to Supabase table rental_data.data
const CLOUD_KEY = "rental-data";

async function cloudGet() {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const isRenter = session.user.user_metadata?.role === "renter" || session.user.email?.endsWith("@renter.beda-rooms.local");
    // renter should read admin's row (RLS policy rental_data renter read admin)
    let targetId = session.user.id;
    if (isRenter) {
      try {
        // Direct rental_data query — RLS allows renter to see admin's row
        // Don't query profiles (RLS blocks it), instead list rental_data rows visible to this renter
        const { data: rows } = await supabase.from("rental_data").select("data,user_id").limit(10);
        if (rows && rows.length) {
          // Prefer row that is not own and has tenants
          const adminRow = rows.find(r => r.user_id !== session.user.id && r.data?.tenants?.length) || rows.find(r => r.user_id !== session.user.id);
          if (adminRow?.user_id) targetId = adminRow.user_id;
          else if (rows[0]?.user_id) targetId = rows[0].user_id;
        }
      } catch {}
    }
    const { data, error } = await supabase
      .from("rental_data")
      .select("data")
      .eq("user_id", targetId)
      .single();
    if (error) {
      // No row yet → treat as empty
      if (error.code === "PGRST116") return null;
      console.warn("[storage cloudGet]", error.message);
      return null;
    }
    if (!data?.data) return null;
    return { key: CLOUD_KEY, value: JSON.stringify(data.data), shared: false };
  } catch (e) {
    console.warn("[storage cloudGet] failed", e);
    return null;
  }
}

async function cloudSet(value) {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return false;
    let parsed;
    try { parsed = JSON.parse(value); } catch { parsed = {}; }
    const { error } = await supabase
      .from("rental_data")
      .upsert({ user_id: session.user.id, data: parsed }, { onConflict: "user_id" });
    if (error) {
      console.warn("[storage cloudSet]", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[storage cloudSet] failed", e);
    return false;
  }
}

window.storage = {
  async get(key, shared = false) {
    // Cloud path only for the main rental-data key when logged in
    if (key === CLOUD_KEY && isSupabaseConfigured) {
      const cloud = await cloudGet();
      const localRaw = (()=>{ try{ return localStorage.getItem(fullKey(key, shared)); }catch{return null}})();
      if (cloud) {
        // Auto-migrate: if cloud is empty default and local has data, push local to cloud instead of clobbering
        try {
          const cloudParsed = JSON.parse(cloud.value);
          const localParsed = localRaw ? JSON.parse(localRaw) : null;
          const cloudEmpty = !cloudParsed.tenants?.length && !Object.keys(cloudParsed.payments || {}).length;
          const localHasData = localParsed && (localParsed.tenants?.length || Object.keys(localParsed.payments || {}).length);
          if (cloudEmpty && localHasData) {
            console.log("[storage] migrating local data to cloud...");
            await cloudSet(localRaw);
            return { key, value: localRaw, shared };
          }
        } catch {}
        // Mirror to localStorage for offline access
        try { localStorage.setItem(fullKey(key, shared), cloud.value); } catch {}
        return cloud;
      }
      // No cloud or not logged in → fall through to local
    }
    try {
      const raw = localStorage.getItem(fullKey(key, shared));
      if (raw === null) return null;
      return { key, value: raw, shared };
    } catch (e) {
      console.error("[storage.get] failed", e);
      return null;
    }
  },

  async set(key, value, shared = false) {
    // Always write local cache first (offline-safe)
    let localOk = false;
    try {
      localStorage.setItem(fullKey(key, shared), value);
      localOk = true;
    } catch (e) {
      console.error("[storage.set local] failed", e);
      if (isQuotaError(e)) return null;
      // proceed to try cloud even if local failed
    }
    // Try cloud if this is the main key and user is logged in
    if (key === CLOUD_KEY && isSupabaseConfigured) {
      const cloudOk = await cloudSet(value);
      // If cloud succeeded, consider it success even if local quota hit
      if (cloudOk) return { key, value, shared };
      // If offline / not logged in, local is enough
      if (localOk) return { key, value, shared };
      return null;
    }
    return localOk ? { key, value, shared } : null;
  },

  async delete(key, shared = false) {
    try {
      const existed = localStorage.getItem(fullKey(key, shared)) !== null;
      localStorage.removeItem(fullKey(key, shared));
      // Delete cloud row only if deleting the main blob
      if (key === CLOUD_KEY && isSupabaseConfigured && supabase) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            await supabase.from("rental_data").delete().eq("user_id", session.user.id);
          }
        } catch (e) { console.warn("[storage.delete cloud]", e); }
      }
      return { key, deleted: existed, shared };
    } catch (e) {
      console.error("[storage.delete] failed", e);
      return { key, deleted: false, shared };
    }
  },

  async list(prefix = "", shared = false) {
    try {
      const searchPrefix = fullKey(prefix, shared);
      const stripLen = fullKey("", shared).length;
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(searchPrefix)) keys.push(k.slice(stripLen));
      }
      return { keys, prefix, shared };
    } catch (e) {
      console.error("[storage.list] failed", e);
      return { keys: [], prefix, shared };
    }
  },

  // Auth helpers for App.jsx
  async getSession() {
    if (!isSupabaseConfigured || !supabase) return null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      return session;
    } catch { return null; }
  },
  async signUp(email, password) {
    if (!isSupabaseConfigured) throw new Error("Supabase not configured — set .env");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  },
  async signIn(email, password) {
    if (!isSupabaseConfigured) throw new Error("Supabase not configured — set .env");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  async signOut() {
    // Always clear local gates immediately so UI can respond even if network hangs.
    // NOTE: never delete tenant data here (rlm:user:/rlm:shared: keys) — signing out
    // must not destroy unsynced records. Only auth gates + Supabase tokens are removed.
    const clearLocal = () => {
      try {
        localStorage.removeItem("rlm:admin-auth");
        localStorage.removeItem("rlm:renter-auth");
        localStorage.removeItem("rlm:renter-creds");
        localStorage.removeItem("rlm:last-tab");
        // Supabase auth tokens
        Object.keys(localStorage).forEach(k => { if (k.startsWith("sb-")) localStorage.removeItem(k); });
        sessionStorage.clear();
      } catch {}
    };
    if (!isSupabaseConfigured || !supabase) {
      clearLocal();
      return;
    }
    // Try cloud signOut but never hang forever (offline / network issues)
    // Use timeout + scope local so it doesn't require network
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("signOut timeout")), 3000));
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }).catch(() => supabase.auth.signOut().catch(()=>{})),
        timeout,
      ]).catch(()=>{});
    } catch {}
    clearLocal();
    // also try global signOut in background (don't await)
    supabase.auth.signOut().catch(()=>{});
  },
  async clearAllCache() {
    try {
      Object.keys(localStorage).forEach(k => { if (k.startsWith(PREFIX) || k.startsWith("sb-") || k === "rlm:last-tab") localStorage.removeItem(k); });
      sessionStorage.clear();
    } catch {}
    try {
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
    } catch {}
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch {}
    return true;
  },
  async clearCacheAndOpenNewWindow() {
    await window.storage.clearAllCache();
    try { await window.storage.signOut(); } catch {}
    const url = location.origin + location.pathname + "?clear=" + Date.now() + "#dashboard";
    window.open(url, "_blank", "noopener");
    location.reload();
  },
  onAuthStateChange(cb) {
    if (!isSupabaseConfigured || !supabase) return () => {};
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
    return () => subscription.unsubscribe();
  },
  isCloudEnabled: isSupabaseConfigured,
};

window.__rlm_storageSize = () => {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) total += (localStorage.getItem(k) || "").length + k.length;
  }
  return total;
};

window.__clearCache = async () => {
  await window.storage.clearAllCache();
  location.reload();
};
window.__clearCacheAndOpenNew = async () => {
  await window.storage.clearCacheAndOpenNewWindow();
};
window.__rlm_supabaseReady = isSupabaseConfigured;
