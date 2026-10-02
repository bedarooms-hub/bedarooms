import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Detect anon key / URL mismatch (common cause of Invalid API key / Failed to fetch)
// JWT payload contains `ref` which must match Project URL subdomain
function getAnonRef(key) {
  try {
    const payload = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.ref || "";
  } catch { return ""; }
}
function getUrlRef(u) {
  try { return new URL(u).hostname.split(".")[0] || ""; } catch { return ""; }
}
const anonRef = anonKey ? getAnonRef(anonKey) : "";
const urlRef = url ? getUrlRef(url) : "";
if (url && anonKey && anonRef && urlRef && anonRef !== urlRef) {
  console.warn(`[supabase] VITE_SUPABASE_URL ref (${urlRef}) != anon key ref (${anonRef}) — will cause Invalid API key. Copy both from Dashboard → Settings → API.`);
}

export const isSupabaseConfigured = Boolean(url && anonKey);
export const isSupabaseMisconfigured = Boolean(url && anonKey && anonRef && urlRef && anonRef !== urlRef);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
