import { useState, useEffect, useMemo, Fragment, useRef } from "react";
import {
  Users, Receipt, FileText, Settings as SettingsIcon, LayoutDashboard,
  Plus, Trash2, Pencil, Printer, CheckCircle2, AlertTriangle, Clock, X, Undo2, Download,
  Menu, Search, Upload, WifiOff, Smartphone, RefreshCw, LogOut, Home,
  Copy, Mail, MessageSquareText, Send, RotateCcw, ChevronDown
} from "lucide-react";
import { supabase } from "./supabase.js";
import RenterDashboard from "./RenterDashboard.jsx";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const STORAGE_KEY = "rental-data";
const TAB_KEY = "rlm:last-tab";
const DEFAULT_SETTINGS = { landlordName: "", landlordAddress: "", landlordContact: "", currency: "₱", gcashNumber: "09123456789", mayaNumber: "09987654321" };
const ROOMS = ["Room 1", "Room 2", "Room 3 (with aircon)", "Room 4"];
const APP_VERSION = "1.1.0-pwa";
const INTAKE_KEY = "rlm:renter-intake-template";
const RENTER_INTAKE_TEMPLATE = `Hello! Welcome to BeDa Rooms. Please reply with your information:

1. Full Name:
2. Contact Number (09xx xxx xxxx):
3. Present Address (Barangay, City):
4. Provincial Address:
5. ID Type + ID Number:
6. Birthdate:
7. Room (Room 1 / Room 2 / Room 3 with aircon / Room 4):
8. Move-in Date:
9. Length of Stay:
10. Payment: Once a month OR Twice a month (15th & 30th):
11. No. of Occupants + Names:
12. Pets (if any):
13. Work/School + Employer Name:
14. Emergency Contact (Name / Relationship / Number):

Please also send a clear photo of 1 valid ID. Your Contact Number will be your Renter login. Thank you!`;

function loadIntakeTemplate() {
  try {
    const saved = localStorage.getItem(INTAKE_KEY);
    if (saved) return saved;
  } catch {}
  return RENTER_INTAKE_TEMPLATE;
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function pad2(n) { return String(n).padStart(2, "0"); }
function periodKey(y, m) { return `${y}-${pad2(m)}`; }
function ordinal(n) {
  n = Number(n);
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayISO() { return toISODate(new Date()); }
function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  const m = MONTHS[d.getMonth()];
  return `${m ? m.slice(0, 3) : "—"} ${d.getDate()}, ${d.getFullYear()}`;
}
function formatMoney(amount, currency) {
  const n = Number(amount) || 0;
  return `${currency}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function amountInWords(n) {
  const num = Math.floor(Number(n) || 0);
  if (num === 0) return "Zero";
  const ones = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const tens = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];
  function chunkToWords(c) {
    let s = "";
    if (c >= 100) { s += ones[Math.floor(c/100)] + " Hundred "; c %= 100; }
    if (c >= 20) { s += tens[Math.floor(c/10)] + " "; c %= 10; }
    if (c > 0) s += ones[c] + " ";
    return s;
  }
  let s = "";
  let x = num;
  const scales = [["",""], ["Thousand","Thousand"], ["Million","Million"], ["Billion","Billion"]];
  let i = 0;
  while (x > 0) {
    const chunk = x % 1000;
    if (chunk) s = chunkToWords(chunk) + scales[i][0] + " " + s;
    x = Math.floor(x / 1000);
    i++;
  }
  return s.trim().replace(/\s+/g," ");
}
function pesoWords(amount, currency) {
  const n = Number(amount) || 0;
  const peso = Math.floor(n);
  const cent = Math.round((n - peso)*100);
  let s = amountInWords(peso) + " Pesos";
  if (cent) s += " and " + amountInWords(cent) + " Centavos";
  return s;
}
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function csvCell(val) {
  const s = String(val ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(rows) { return rows.map(r => r.map(csvCell).join(",")).join("\r\n"); }
function parsePeriodKey(key) {
  const parts = String(key).split("-");
  return { year: Number(parts[0]), month: Number(parts[1]), half: parts[2] || null };
}
function getAllPaymentHistory(tenants, payments) {
  const rows = [];
  tenants.forEach(t => {
    const tenantPayments = payments[t.id] || {};
    Object.entries(tenantPayments).forEach(([key, rec]) => {
      if (rec && rec.status === "paid") {
        const { year, month, half } = parsePeriodKey(key);
        rows.push({
          tenantId: t.id,
          tenantName: t.name,
          room: t.room || "",
          periodLabel: periodDisplayLabel(year, month, half),
          amountPaid: Number(rec.amountPaid) || 0,
          paidDate: rec.paidDate || "",
          notes: rec.notes || "",
          paymentMethod: rec.paymentMethod || null,
        });
      }
    });
  });
  rows.sort((a, b) => (b.paidDate || "").localeCompare(a.paidDate || ""));
  return rows;
}
function isSemiMonthly(tenant) { return tenant.paymentFrequency === "semimonthly"; }
function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
function dueDateFor(tenant, year, month, half = null) {
  if (isSemiMonthly(tenant)) {
    const dim = daysInMonth(year, month);
    const day = half === "b" ? Math.min(30, dim) : Math.min(15, dim);
    return new Date(year, month - 1, day);
  }
  const day = Math.min(Number(tenant.dueDay) || 1, daysInMonth(year, month));
  return new Date(year, month - 1, day);
}
function periodKeyFor(tenant, year, month, half = null) {
  return isSemiMonthly(tenant) ? `${periodKey(year, month)}-${half}` : periodKey(year, month);
}
function getPeriodsForTenant(tenant) {
  if (!tenant.moveInDate) return [];
  const start = new Date(tenant.moveInDate + "T00:00:00");
  let y = start.getFullYear(), m = start.getMonth() + 1;
  const now = new Date();
  const nowY = now.getFullYear(), nowM = now.getMonth() + 1;
  const periods = [];
  let guard = 0;
  const pushMonth = (yy, mm) => {
    if (isSemiMonthly(tenant)) {
      periods.push({ year: yy, month: mm, half: "a", key: periodKeyFor(tenant, yy, mm, "a") });
      periods.push({ year: yy, month: mm, half: "b", key: periodKeyFor(tenant, yy, mm, "b") });
    } else {
      periods.push({ year: yy, month: mm, half: null, key: periodKeyFor(tenant, yy, mm, null) });
    }
  };
  if (y > nowY || (y === nowY && m > nowM)) {
    pushMonth(y, m);
    return periods;
  }
  while ((y < nowY || (y === nowY && m <= nowM)) && guard < 600) {
    pushMonth(y, m);
    m++;
    if (m > 12) { m = 1; y++; }
    guard++;
  }
  return periods.reverse();
}
function recurringTotal(tenant) {
  return (tenant.additionalFees || []).reduce((s, f) => s + (Number(f.amount) || 0), 0);
}
function meterChargeId(submeterId) { return `meter:${submeterId}`; }
function computeMeterAmount(previous, current, rate) {
  const prev = Number(previous) || 0;
  const curr = Number(current) || 0;
  const consumption = Math.max(curr - prev, 0);
  const amount = consumption * (Number(rate) || 0);
  return { consumption, amount };
}
function meterChargeLabel(submeter, previous, current, consumption) {
  const unit = submeter.unit ? ` ${submeter.unit}` : "";
  return `${submeter.label} (${previous} → ${current}${unit}, ${consumption}${unit} used)`;
}
function getPreviousMeterReading(tenant, payments, submeterId, periodKeyVal) {
  const ascPeriods = getPeriodsForTenant(tenant).slice().reverse();
  const idx = ascPeriods.findIndex(p => p.key === periodKeyVal);
  if (idx <= 0) return 0;
  const tenantPayments = payments[tenant.id] || {};
  for (let i = idx - 1; i >= 0; i--) {
    const rec = tenantPayments[ascPeriods[i].key];
    const mr = rec && rec.meterReadings && rec.meterReadings[submeterId];
    if (mr && mr.current !== undefined && mr.current !== null && mr.current !== "") {
      return Number(mr.current) || 0;
    }
  }
  return 0;
}
const DEPOSIT_TYPES = {
  none: "None",
  advance: "1 month advance (no deposit)",
  deposit: "1 month deposit (no advance)",
  both: "1 month advance + 1 month deposit",
  custom: "Custom arrangement",
};
function depositSummary(tenant, currency) {
  const type = tenant.depositType || "none";
  if (type === "none") return "—";
  if (type === "custom") return tenant.depositNotes ? tenant.depositNotes : "Custom";
  const parts = [];
  if (type === "advance" || type === "both") parts.push(`Advance ${formatMoney(tenant.advanceAmount, currency)}`);
  if (type === "deposit" || type === "both") parts.push(`Deposit ${formatMoney(tenant.depositAmount, currency)}`);
  return parts.join(" + ");
}
function halfLabel(half) { return half === "a" ? "15th" : half === "b" ? "30th" : ""; }
function periodDisplayLabel(year, month, half) {
  return half ? `${MONTHS[month - 1]} ${year} (${halfLabel(half)})` : `${MONTHS[month - 1]} ${year}`;
}
function getPeriodInfo(tenant, payments, year, month, half = null) {
  const semi = isSemiMonthly(tenant);
  const key = periodKeyFor(tenant, year, month, half);
  const rec = (payments[tenant.id] || {})[key];
  const dueDate = dueDateFor(tenant, year, month, half);
  const baseFull = Number(tenant.monthlyRent) || 0;
  const recFull = recurringTotal(tenant);
  const base = semi ? baseFull / 2 : baseFull;
  const recTotal = semi ? recFull / 2 : recFull;
  const recurringFees = semi
    ? (tenant.additionalFees || []).map(f => ({ ...f, amount: (Number(f.amount) || 0) / 2 }))
    : (tenant.additionalFees || []);
  const charges = (rec && rec.charges) || [];
  const chargesTotal = charges.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const subtotal = base + recTotal + chargesTotal;
  const notes = (rec && rec.notes) || "";
  if (rec && rec.status === "paid") {
    const interest = Number(rec.interestApplied) || 0;
    return { key, half, semi, dueDate, base, recurringFees, charges, chargesTotal, recTotal, subtotal, interest, total: subtotal + interest, status: "paid", amountPaid: Number(rec.amountPaid) || 0, paidDate: rec.paidDate, notes, paymentMethod: rec.paymentMethod || null };
  }
  const isLate = new Date() > dueDate;
  const interest = (!semi && isLate) ? subtotal * 0.01 : 0;
  return { key, half, semi, dueDate, base, recurringFees, charges, chargesTotal, recTotal, subtotal, interest, total: subtotal + interest, status: isLate ? "overdue" : "due", amountPaid: 0, paidDate: null, notes, paymentMethod: null };
}

// hooks
function useOnline() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}
function usePWA() {
  const [deferred, setDeferred] = useState(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(display-mode: standalone)");
    const check = () => setIsStandalone(mql.matches || window.navigator.standalone);
    check();
    mql.addEventListener?.("change", check);
    const handler = (e) => { e.preventDefault(); setDeferred(e); setCanInstall(true); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => { setCanInstall(false); setDeferred(null); });
    return () => { window.removeEventListener("beforeinstallprompt", handler); mql.removeEventListener?.("change", check); };
  }, []);
  const prompt = async () => {
    if (!deferred) return false;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null); setCanInstall(false);
    return outcome === "accepted";
  };
  return { canInstall, isStandalone, prompt };
}
function useSWUpdate() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const updateSWRef = useRef(null);
  useEffect(() => {
    let unsub = null;
    (async () => {
      try {
        const mod = await import("virtual:pwa-register");
        const registerSW = mod.registerSW;
        unsub = registerSW({
          onNeedRefresh() { setNeedRefresh(true); },
          onOfflineReady() { setOfflineReady(true); },
          onRegisteredSW(_, r) {
            updateSWRef.current = r?.update || null;
            if (r) setInterval(() => r.update(), 60*60*1000);
          }
        });
      } catch {
        // not in PWA context (dev)
      }
    })();
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);
  const reload = async () => {
    try {
      // prompt mode: need to update SW before reload, else stale cache
      const mod = await import("virtual:pwa-register");
      // if update available, activate it
      if (updateSWRef.current) await updateSWRef.current();
    } catch {}
    window.location.reload();
  };
  const forceUpdate = async () => {
    try {
      if (updateSWRef.current) await updateSWRef.current(true);
    } catch {}
    window.location.reload();
  };
  return { needRefresh, offlineReady, reload, forceUpdate, dismiss: () => { setNeedRefresh(false); setOfflineReady(false); } };
}

const ADMIN_EMAIL = "bedarooms@gmail.com";
const ADMIN_PASS = "Bhingdan7*";
const ADMIN_KEY = "rlm:admin-auth";
const RENTER_KEY = "rlm:renter-auth";
function phoneToEmail(phone){ const d=String(phone).replace(/\D/g,""); return `r${d}@renter.beda-rooms.local`; }
function isAdminSession(s){ return s?.user?.email===ADMIN_EMAIL || s?.user?.id==="admin-local"; }
function isRenterSession(s){ return s?.user?.email?.endsWith("@renter.beda-rooms.local") || s?.user?.id==="renter-local"; }

function useSupabaseAuth() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const cloudEnabled = typeof window !== "undefined" && window.storage?.isCloudEnabled;
  useEffect(() => {
    // hardcoded gates take priority (fixes admin offline login not working after renter session)
    const localAdmin = (()=>{ try{ return localStorage.getItem(ADMIN_KEY); }catch{return null}})();
    if (localAdmin === ADMIN_EMAIL) {
      setSession({ user: { email: ADMIN_EMAIL, id: "admin-local" } });
      setAuthLoading(false);
      return;
    }
    const localRenter = (()=>{ try{ return JSON.parse(localStorage.getItem(RENTER_KEY)||"null"); }catch{return null}})();
    if (localRenter?.phone) {
      setSession({ user: { email: phoneToEmail(localRenter.phone), id: "renter-local", phone: localRenter.phone } });
      setAuthLoading(false);
      return;
    }
    if (!cloudEnabled) { setAuthLoading(false); return; }
    let mounted = true;
    window.storage.getSession().then(s => {
      if (!mounted) return;
      if (s) {
        if (s.user?.email?.endsWith("@renter.beda-rooms.local") && s.user?.user_metadata?.phone) s.user.phone = s.user.user_metadata.phone;
        setSession(s);
      } else {
        setSession(null);
      }
      setAuthLoading(false);
    });
    const unsub = window.storage.onAuthStateChange((s) => {
      if (!mounted) return;
      if (s?.user?.email?.endsWith("@renter.beda-rooms.local") && s.user?.user_metadata?.phone) s.user.phone = s.user.user_metadata.phone;
      if (s) {
        // if admin gate was set, keep it (admin bypass)
        const la = (()=>{ try{ return localStorage.getItem(ADMIN_KEY);}catch{return null}})();
        if (la === ADMIN_EMAIL) return;
        setSession(s);
      } else {
        // signed out in cloud -> clear stale gates BUT preserve hardcoded admin (offline login)
        const la = (()=>{ try{ return localStorage.getItem(ADMIN_KEY);}catch{return null}})();
        if (la === ADMIN_EMAIL) return;
        try { localStorage.removeItem(RENTER_KEY); } catch {}
        // don't wipe ADMIN_KEY if it's the hardcoded admin — it must survive Supabase signOut
        // only clear RENTER_KEY and let UI stay on admin if needed
        setSession(prev => {
          if (prev?.user?.id === "admin-local") return prev;
          return null;
        });
      }
    });
    return () => { mounted = false; unsub?.(); };
  }, [cloudEnabled]);
  const clearAdmin = async () => {
    try{
      localStorage.removeItem(ADMIN_KEY);
      localStorage.removeItem(RENTER_KEY);
      localStorage.removeItem(TAB_KEY);
      // clear rlm cache so next window is clean
      Object.keys(localStorage).forEach(k=>{ if(k.startsWith("rlm:")||k.startsWith("sb-")) localStorage.removeItem(k); });
      sessionStorage.clear();
      if ("caches" in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n=>caches.delete(n)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r=>r.unregister()));
      }
    }catch{}
    setSession(null);
  };
  return { session, authLoading, cloudEnabled, clearAdmin };
}

function AuthPanel({ session, showToast }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("signin");
  const [busy, setBusy] = useState(false);
  if (!window.storage?.isCloudEnabled) {
    return (
      <div style={{ background:"#FFF8E1", border:"1px dashed #C9C3B0", borderRadius:6, padding:12, marginBottom:16, fontSize:13 }}>
        <strong>Cloud sync disabled</strong> — set <code>VITE_SUPABASE_URL</code> + <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env</code> (copy from <code>.env.example</code>), run <code>supabase/schema.sql</code> in Supabase SQL Editor, then restart dev. Data stays in this browser only.
      </div>
    );
  }
  if (session?.user) {
    return (
      <div style={{ background:"#E8F5E9", border:"1px solid #A5D6A7", borderRadius:6, padding:12, marginBottom:16, fontSize:13, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
        <span>Cloud: <strong>{session.user.email}</strong> — synced ✓ ({String(session.user.id||"").slice(0,8)}…)</span>
        <button type="button" className="rlm-btn rlm-btn-ghost" style={{ padding:"6px 10px" }} onClick={async()=>{
          try { localStorage.removeItem(ADMIN_KEY); localStorage.removeItem(RENTER_KEY); } catch {}
          try { await window.storage.signOut(); } catch {}
          try { showToast("Signed out"); } catch {}
          setTimeout(()=>window.location.reload(), 150);
        }}><LogOut size={14}/> Sign out</button>
      </div>
    );
  }
  const submit = async () => {
    if (!email || !password) { showToast("Enter email + password"); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        await window.storage.signUp(email, password);
        showToast("Check email to confirm, then sign in");
      } else {
        await window.storage.signIn(email, password);
        showToast("Signed in — syncing…");
      }
    } catch (e) { showToast(e.message || "Auth failed"); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ background:"white", border:"1px solid var(--line)", borderRadius:6, padding:14, marginBottom:16 }}>
      <div style={{ fontWeight:600, marginBottom:8 }}>Cloud sync (Supabase) — sign in to sync across devices</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
        <input className="rlm-input" style={{ flex:"1 1 180px" }} placeholder="email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input className="rlm-input" style={{ flex:"1 1 140px" }} type="password" placeholder="password (≥6 chars)" value={password} onChange={e=>setPassword(e.target.value)} />
      </div>
      <div style={{ display:"flex", gap:8 }}>
        <button className="rlm-btn rlm-btn-primary" disabled={busy} onClick={submit}>{busy ? "…" : mode==="signup" ? "Sign up" : "Sign in"}</button>
        <button className="rlm-btn rlm-btn-ghost" onClick={()=>setMode(mode==="signup"?"signin":"signup")}>{mode==="signup"?"Have account? Sign in":"Need account? Sign up"}</button>
      </div>
      <div style={{ fontSize:11, color:"#5b6663", marginTop:8 }}>Data syncs to <code>rental_data</code> table (RLS per user). Offline still works — localStorage is mirrored.</div>
    </div>
  );
}

function LoginGate({ session, showToast, saveTenant }) {
  const [tab, setTab] = useState("admin"); // admin | renter
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [renterPass, setRenterPass] = useState("");
  const [mode, setMode] = useState("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cloudEnabled = window.storage?.isCloudEnabled;

  const submitAdmin = async (e) => {
    e?.preventDefault();
    const eTrim = String(email).trim().toLowerCase();
    const pTrim = String(password).trim();
    if (!eTrim || !pTrim) { setError("Enter email and password"); return; }
    // Hardcoded owner bypass always works offline (fixes admin offline login not working after renter session / Supabase misconfig)
    if (eTrim === ADMIN_EMAIL && pTrim === ADMIN_PASS) {
      try {
        // clear any previous renter/cloud session so admin-local wins (fixes bug where renter session blocks admin)
        // don't hang on Supabase signOut if network is down — timeout quickly
        try { await Promise.race([window.storage.signOut().catch(()=>{}), new Promise(r=>setTimeout(r, 800))]); } catch {}
        localStorage.removeItem(RENTER_KEY);
        localStorage.removeItem(TAB_KEY);
        localStorage.removeItem("rlm:renter-creds");
        localStorage.setItem(ADMIN_KEY, ADMIN_EMAIL);
      } catch {}
      // optional cloud sync — ignore failure (hardcoded admin works offline)
      if (cloudEnabled && supabase) window.storage.signIn(email, password).catch(()=>{});
      showToast("Admin access granted (offline)");
      window.location.reload();
      return;
    }
    // normalize for Supabase (case-insensitive email)
    const normalizedEmail = String(email).trim().toLowerCase();
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    setBusy(true); setError("");
    const isNetworkError = (msg) => {
      const low = String(msg||"").toLowerCase();
      return low.includes("failed to fetch") || low.includes("fetch") || low.includes("network") || low.includes("load failed");
    };
    const isKeyError = (msg) => {
      const low = String(msg||"").toLowerCase();
      return low.includes("invalid api key") || low.includes("api key");
    };
    try {
      if (mode === "signup") {
        await window.storage.signUp(normalizedEmail, password);
        showToast("Account created — check email to confirm, then sign in (or disable Confirm email in Supabase Auth → Configuration → Email)");
        setMode("signin");
      } else {
        await window.storage.signIn(normalizedEmail, password);
        try { localStorage.setItem(ADMIN_KEY, normalizedEmail); } catch {}
        showToast("Welcome back — loading your data…");
        window.location.reload();
        return;
      }
    } catch (err) {
      const m = (err.message||"").toLowerCase();
      const raw = err.message || "Auth failed";
      if (isNetworkError(raw)) setError("Failed to fetch — cannot reach Supabase. VITE_SUPABASE_URL is " + (import.meta.env.VITE_SUPABASE_URL || "missing") + ". Copy correct URL + anon key from Dashboard → Settings → API (Project mpyyiacudehygwwoobojx) then restart dev server (npm run dev). Tip: owner can still sign in with bedarooms@gmail.com offline.");
      else if (isKeyError(raw)) setError("Invalid API key — .env URL/key mismatch. Your Project URL is https://mpyyiacudehygwwoobojx.supabase.co — copy BOTH Project URL and anon public key from Dashboard → Settings → API, paste into .env, then restart dev server. Owner offline login still works: bedarooms@gmail.com");
      else if (m.includes("email not confirmed")) setError("Email not confirmed — disable Confirm email in Dashboard → Auth → Configuration → Email, or confirm the user in Dashboard → Auth → Users. Or use offline owner login bedarooms@gmail.com.");
      else if (m.includes("invalid login") || m.includes("invalid credentials")) setError("Invalid email or password. If you just created the account, sign in again or disable email confirmation. Owner offline: bedarooms@gmail.com");
      else setError(raw);
    }
    finally { setBusy(false); }
  };
  const submitRenter = async (e) => {
    e?.preventDefault();
    const p = String(phone).replace(/\D/g,"");
    const pPass = String(renterPass).trim();
    if (!p || !pPass) { setError("Enter phone and password"); return; }
    if (p.length < 10) { setError("Enter valid phone number (10-11 digits)"); return; }
    if (pPass.length < 6) { setError("Password must be at least 6 characters"); return; }
    const rEmail = phoneToEmail(p);
    setBusy(true); setError("");
    const isNetworkError = (msg) => {
      const low = String(msg||"").toLowerCase();
      return low.includes("failed to fetch") || low.includes("fetch") || low.includes("network") || low.includes("load failed") || low.includes("unable to");
    };
    const isKeyError = (msg) => {
      const low = String(msg||"").toLowerCase();
      return low.includes("invalid api key") || low.includes("api key");
    };
    // local creds fallback for offline / misconfigured Supabase (demo only)
    const credKey = "rlm:renter-creds";
    const getLocalCreds = () => { try { return JSON.parse(localStorage.getItem(credKey)||"{}"); } catch { return {}; } };
    const setLocalCred = (email, pass) => {
      try {
        const m = getLocalCreds();
        m[email] = pass;
        localStorage.setItem(credKey, JSON.stringify(m));
      } catch {}
    };
    const checkLocalCred = (email, pass) => {
      const m = getLocalCreds();
      return m[email] && m[email] === pass;
    };
    try {
      if (mode === "signup") {
        let cloudOk = false;
        let cloudErr = null;
        if (cloudEnabled && supabase) {
          try {
            const { error } = await supabase.auth.signUp({ email: rEmail, password: pPass, options: { data: { phone: p } } });
            if (error) throw error;
            cloudOk = true;
          } catch (err) { cloudErr = err; }
        } else {
          try { await window.storage.signUp(rEmail, pPass); cloudOk = true; } catch (err) { cloudErr = err; }
        }
        if (cloudOk) {
          showToast("Renter account created — you can now sign in with your phone");
          // store local copy for offline fallback too
          setLocalCred(rEmail, pPass);
          setMode("signin");
          return;
        }
        // cloud failed — check if it's network/key error → fallback to local offline account
        const msg = cloudErr?.message || "";
        if (isNetworkError(msg) || isKeyError(msg)) {
          // create local offline renter account so login still works for demo/offline
          setLocalCred(rEmail, pPass);
          showToast("Renter account created locally (Supabase offline: " + (isKeyError(msg) ? "Invalid API key — fix .env anon key" : "Failed to fetch") + "). You can sign in now — data will sync when Supabase is fixed. Fix: copy correct anon key from Dashboard → Settings → API.");
          setMode("signin");
          return;
        }
        if (String(msg).toLowerCase().includes("user already registered") || String(msg).toLowerCase().includes("already registered") || String(msg).toLowerCase().includes("already exists")) {
          setError("This phone already has an account — tap 'Have an account? Sign in' and enter your password. If you forgot password, ask admin to reset in Supabase Dashboard → Auth → Users.");
          return;
        }
        if (String(msg).toLowerCase().includes("email not confirmed")) {
          setError("Email not confirmed — run supabase/schema.sql fix + disable Confirm email in Dashboard → Auth → Providers -> Email, or ask admin to confirm your renter email in Dashboard → Users.");
          return;
        }
        throw cloudErr;
      } else {
        // signin
        let cloudOk = false;
        let cloudErr = null;
        if (cloudEnabled && supabase) {
          try {
            const { error } = await supabase.auth.signInWithPassword({ email: rEmail, password: pPass });
            if (error) throw error;
            cloudOk = true;
          } catch (err) { cloudErr = err; }
        } else {
          try { await window.storage.signIn(rEmail, pPass); cloudOk = true; } catch (err) { cloudErr = err; }
        }
        if (cloudOk) {
          try {
            localStorage.removeItem(ADMIN_KEY);
            localStorage.setItem(RENTER_KEY, JSON.stringify({ phone: p }));
          } catch {}
          setLocalCred(rEmail, pPass);
          // Auto-create tenant record so renter can access their own data after login
          if (saveTenant) {
            const tenant = {
              id: uid(),
              name: "",
              contact: p,
              room: "",
              roomLabel: "",
              idNumber: "",
              address: "",
              monthlyRent: 0,
              dueDay: 1,
              moveInDate: todayISO(),
              paymentFrequency: "monthly",
              depositType: "none",
              advanceAmount: 0,
              depositAmount: 0,
              depositNotes: "",
              additionalFees: [],
              submeters: [],
            };
            try { await saveTenant(tenant); } catch {}
          }
          showToast("Welcome — your account is set up. Please fill in your details (name, room) in Tenants.");
          window.location.reload();
          return;
        }
        const msg = cloudErr?.message || "";
        // offline fallback: check local creds
        if ((isNetworkError(msg) || isKeyError(msg) || String(msg).toLowerCase().includes("invalid login")) && checkLocalCred(rEmail, pPass)) {
          try {
            localStorage.removeItem(ADMIN_KEY);
            localStorage.setItem(RENTER_KEY, JSON.stringify({ phone: p }));
          } catch {}
          // Auto-create tenant for offline/local sign-in
          if (saveTenant) {
            const tenant = { id: uid(), name: "", contact: p, room: "", roomLabel: "", idNumber: "", address: "", monthlyRent: 0, dueDay: 1, moveInDate: todayISO(), paymentFrequency: "monthly", depositType: "none", advanceAmount: 0, depositAmount: 0, depositNotes: "", additionalFees: [], submeters: [] };
            try { await saveTenant(tenant); } catch {}
          }
          showToast("Signed in locally (Supabase " + (isKeyError(msg) ? "Invalid API key — fix .env" : "offline") + ") — your rental data is from local cache. Fix Supabase for cloud sync.");
          window.location.reload();
          return;
        }
        // also allow offline signin even if no local cred yet but phone matches a tenant contact (demo convenience)
        // — but require password check if we have stored creds
        if (isNetworkError(msg) || isKeyError(msg)) {
          // no stored cred → create ephemeral session for demo so renter can still view own data if admin data is in localStorage
          // still require password length, but allow through with warning
          try {
            localStorage.removeItem(ADMIN_KEY);
            localStorage.setItem(RENTER_KEY, JSON.stringify({ phone: p }));
          } catch {}
          // Auto-create tenant for offline/ephemeral session
          if (saveTenant) {
            const tenant = { id: uid(), name: "", contact: p, room: "", roomLabel: "", idNumber: "", address: "", monthlyRent: 0, dueDay: 1, moveInDate: todayISO(), paymentFrequency: "monthly", depositType: "none", advanceAmount: 0, depositAmount: 0, depositNotes: "", additionalFees: [], submeters: [] };
            try { await saveTenant(tenant); } catch {}
          }
          showToast("Signed in locally (Supabase offline). Fix .env anon key + restart dev for cloud sync.");
          window.location.reload();
          return;
        }
        if (String(msg).toLowerCase().includes("email not confirmed")) {
          setError("Email not confirmed — disable Confirm email in Dashboard → Auth → Configuration → Email, or manually confirm the user in Dashboard → Auth → Users. Then try sign in again.");
          return;
        }
        if (String(msg).toLowerCase().includes("invalid login") || String(msg).toLowerCase().includes("invalid credentials")) {
          setError("Invalid phone or password — check your phone number (must match Contact saved by admin) and password. If you just created the account, wait for email confirmation or disable it in Supabase.");
          return;
        }
        throw cloudErr;
      }
    } catch (err) {
        const msg = err.message || "";
        const low = msg.toLowerCase();
        if (low.includes("failed to fetch") || low.includes("fetch") || low.includes("network")) {
          setError("Failed to fetch — cannot reach Supabase. 1) Check VITE_SUPABASE_URL in .env matches Dashboard → Project Settings → API → Project URL (" + (import.meta.env.VITE_SUPABASE_URL || "missing") + "), 2) Check VITE_SUPABASE_ANON_KEY matches anon key there, 3) Restart dev server (npm run dev). Your project (screenshot) is mpyyiacudehygwwoobojx.");
        } else if (low.includes("invalid api key") || low.includes("api key")) {
          setError("Invalid API key — .env URL/key mismatch. Your Project URL is https://mpyyiacudehygwwoobojx.supabase.co — copy BOTH Project URL and anon public key from Dashboard → Settings → API, paste into .env, then restart dev server (npm run dev). Current anon key is for old ref mpyyiacudehxgwoobojx and will fail.");
        } else if (low.includes("email not confirmed")) {
          setError("Email not confirmed — disable Confirm email in Dashboard → Auth → Configuration → Email, or manually confirm the user in Dashboard → Auth → Users.");
        } else { setError(msg || "Phone login failed — ask admin to confirm your number is registered as tenant contact"); }
      }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight:"100dvh", display:"flex", alignItems:"center", justifyContent:"center", background:"#EFEDE3", padding:20, fontFamily:"var(--font-body, sans-serif)" }}>
      <div style={{ background:"white", border:"1px solid var(--line)", borderRadius:10, padding:24, maxWidth:400, width:"100%", boxShadow:"0 8px 30px rgba(0,0,0,0.08)" }}>
        <div style={{ fontFamily:"var(--font-display)", fontSize:22, fontWeight:700, color:"#1B2A28" }}>BeDa Rooms</div>
        <div style={{ fontSize:13, color:"#5b6663", marginBottom:12 }}>Choose how to sign in — Admin (owner) or Renter (phone).</div>
        <div style={{ display:"flex", gap:8, marginBottom:16 }}>
          <button onClick={()=>{ setTab("admin"); setError(""); }} className={tab==="admin" ? "rlm-btn rlm-btn-primary" : "rlm-btn rlm-btn-ghost"} style={{ flex:1, justifyContent:"center" }}>Admin</button>
          <button onClick={()=>{ setTab("renter"); setError(""); }} className={tab==="renter" ? "rlm-btn rlm-btn-primary" : "rlm-btn rlm-btn-ghost"} style={{ flex:1, justifyContent:"center" }}><Smartphone size={14}/> Renter</button>
        </div>
        {!cloudEnabled && <div style={{ background:"#FFF3CD", border:"1px solid #FFE69C", borderRadius:6, padding:10, fontSize:12, marginBottom:12 }}>Supabase not configured — renter sync needs cloud. Add <code>.env</code> and redeploy.</div>}
        {(() => {
          try {
            const url = import.meta.env.VITE_SUPABASE_URL || "";
            const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
            if (!url || !key) return null;
            const urlRef = new URL(url).hostname.split(".")[0];
            let anonRef = "";
            try { anonRef = JSON.parse(atob(key.split(".")[1].replace(/-/g,"+").replace(/_/g,"/"))).ref || ""; } catch {}
            if (anonRef && urlRef && anonRef !== urlRef) {
              return <div style={{ background:"#F6E3DE", border:"1px solid var(--rust)", borderRadius:6, padding:10, fontSize:12, marginBottom:12, color:"var(--rust)" }}><strong>.env mismatch:</strong> URL is <code>{urlRef}</code> but anon key is for <code>{anonRef}</code> — will cause <strong>Invalid API key / Failed to fetch</strong>. Copy correct pair from Supabase Dashboard → Settings → API (Project <code>mpyyiacudehygwwoobojx</code>), paste into <code>.env</code>, restart <code>npm run dev</code>. Admin offline login <code>bedarooms@gmail.com</code> still works.</div>;
            }
          } catch {}
          return null;
        })()}
        {tab==="admin" ? (
          <form onSubmit={submitAdmin}>
            <div className="rlm-field"><label className="rlm-label">Admin Email</label><input className="rlm-input" type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="bedarooms@gmail.com" autoComplete="email" /></div>
            <div className="rlm-field"><label className="rlm-label">Password</label><input className="rlm-input" type="password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode==="signin"?"current-password":"new-password"} /></div>
            {error && <div style={{ background:"#F6E3DE", border:"1px solid var(--rust)", color:"var(--rust)", padding:"8px 10px", borderRadius:4, fontSize:12, marginBottom:10 }}>{error}</div>}
            <button type="submit" className="rlm-btn rlm-btn-primary" style={{ width:"100%", justifyContent:"center", padding:"10px" }} disabled={busy}>{busy ? "Please wait…" : mode==="signup" ? "Create admin account" : "Sign in as Admin"}</button>
            <div style={{ display:"flex", justifyContent:"center", marginTop:10 }}>
              <button type="button" className="rlm-btn rlm-btn-ghost" style={{ fontSize:12, padding:"6px 10px" }} onClick={()=>{ setMode(mode==="signup"?"signin":"signup"); setError(""); }}>{mode==="signup" ? "Have an account? Sign in" : "Need an account? Sign up"}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitRenter}>
            <div className="rlm-field"><label className="rlm-label">Phone number (as registered with admin)</label><input className="rlm-input" type="tel" required value={phone} onChange={e=>setPhone(e.target.value)} placeholder="09xx xxx xxxx" autoComplete="tel" /></div>
            <div className="rlm-field"><label className="rlm-label">Password</label><input className="rlm-input" type="password" required value={renterPass} onChange={e=>setRenterPass(e.target.value)} placeholder="Create or enter password (≥6 chars)" /></div>
            {error && <div style={{ background:"#F6E3DE", border:"1px solid var(--rust)", color:"var(--rust)", padding:"8px 10px", borderRadius:4, fontSize:12, marginBottom:10 }}>{error}</div>}
            <button type="submit" className="rlm-btn rlm-btn-primary" style={{ width:"100%", justifyContent:"center", padding:"10px" }} disabled={busy}>{busy ? "Please wait…" : mode==="signup" ? "Create renter account" : "Sign in as Renter"}</button>
            <div style={{ display:"flex", justifyContent:"center", marginTop:10 }}>
              <button type="button" className="rlm-btn rlm-btn-ghost" style={{ fontSize:12, padding:"6px 10px" }} onClick={()=>{ setMode(mode==="signup"?"signin":"signup"); setError(""); }}>{mode==="signup" ? "Have an account? Sign in" : "New renter? Create account"}</button>
            </div>
            <div style={{ fontSize:11, color:"#5b6663", textAlign:"center", marginTop:8 }}>Phone must match the Contact number admin saved for you in Tenants. You’ll then see your ID, contract, and payment history including advance/deposit.</div>
          </form>
        )}
        <div style={{ fontSize:11, color:"#5b6663", textAlign:"center", marginTop:12 }}>Admin sees all tenants & yearly income. Renters see only their own rental info.</div>
      </div>
    </div>
  );
}

function RenterPortal({ tenants, payments, settings, session, showToast, clearAdmin, saveTenant }) {
  const phone = session?.user?.phone || (()=>{ try{ return JSON.parse(localStorage.getItem(RENTER_KEY)||"{}").phone; }catch{return null}})() || "";
  const digits = String(phone).replace(/\D/g,"");
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", contact: "", room: "", roomLabel: "", address: "", idNumber: "", monthlyRent: "", dueDay: 1, moveInDate: "", paymentFrequency: "monthly" });
  const myTenant = useMemo(()=>{
    if (!digits) return null;
    return tenants.find(t=>{
      const c = String(t.contact||"").replace(/\D/g,"");
      return c && (c===digits || c.slice(-10)===digits.slice(-10) || digits.slice(-10)===c.slice(-10));
    }) || null;
  }, [tenants, digits]);
  const periods = myTenant ? getPeriodsForTenant(myTenant) : [];
  const myPayments = myTenant ? (payments[myTenant.id]||{}) : {};
  const history = useMemo(()=>{
    if (!myTenant) return [];
    const rows = [];
    Object.entries(myPayments).forEach(([key, rec])=>{
      if (rec?.status==="paid") {
        const { year, month, half } = parsePeriodKey(key);
        rows.push({ key, periodLabel: periodDisplayLabel(year, month, half), amountPaid: rec.amountPaid, paidDate: rec.paidDate, notes: rec.notes||"" });
      }
    });
    rows.sort((a,b)=> (b.paidDate||"").localeCompare(a.paidDate||""));
    return rows;
  }, [myTenant, myPayments]);
  const signOut = async()=>{
    try { localStorage.removeItem(RENTER_KEY); localStorage.removeItem(ADMIN_KEY); } catch {}
    try { await Promise.race([window.storage.signOut(), new Promise((_,rej)=>setTimeout(()=>rej(new Error("t")), 3500))]); } catch {}
    try { await clearAdmin?.(); } catch {}
    window.location.reload();
  };
  const startEdit = () => {
    if (!myTenant) return;
    setEditForm({ name: myTenant.name||"", contact: myTenant.contact||"", room: myTenant.room||"", roomLabel: myTenant.roomLabel||"", address: myTenant.address||"", idNumber: myTenant.idNumber||"", monthlyRent: myTenant.monthlyRent != null ? String(myTenant.monthlyRent) : "", dueDay: myTenant.dueDay||1, moveInDate: myTenant.moveInDate||"", paymentFrequency: myTenant.paymentFrequency||"monthly" });
    setEditing(true);
  };
  const saveMyProfile = async () => {
    if (!myTenant || !editForm.name.trim()) return;
    const updated = { ...myTenant, ...editForm, monthlyRent: Number(editForm.monthlyRent)||0 };
    try { await saveTenant(updated); } catch {}
    setEditing(false);
    showToast("Profile updated");
  };
  return (
    <div className="rlm-app">
      <div className="rlm-topbar no-print" style={{ justifyContent:"space-between", display:"flex" }}>
        <span style={{ fontFamily:"var(--font-display)", fontWeight:600 }}>BeDa Rooms — My Rental</span>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <span style={{ fontSize:11, background:"rgba(255,255,255,0.15)", padding:"4px 8px", borderRadius:4 }}>{phone || session?.user?.email}</span>
          <button type="button" onClick={signOut} style={{ background:"rgba(255,255,255,0.12)", color:"white", border:"1px solid rgba(255,255,255,0.2)", padding:"4px 8px", borderRadius:4, display:"inline-flex", alignItems:"center", gap:4, cursor:"pointer" }}><LogOut size={12}/> Sign out</button>
        </div>
      </div>
      <div className="rlm-main" style={{ maxWidth:720, margin:"0 auto" }}>
        {!myTenant ? (
          <div className="rlm-card" style={{ borderColor:"var(--rust)" }}>
            <h2 style={{ marginTop:0 }}>No tenant found for {phone ? formatPhone(phone) : "your phone"}</h2>
            <p style={{ fontSize:13, color:"#5b6663" }}>Your phone isn’t linked to any tenant yet. Ask the owner (bedarooms@gmail.com) to set your <strong>Contact number</strong> in Tenants → Edit to match this phone. Then reload.</p>
            <p style={{ fontSize:12, color:"#5b6663" }}>Checked {tenants.length} tenant(s). Ensure Contact is digits only, e.g., 09xx xxx xxxx.</p>
            <button className="rlm-btn rlm-btn-ghost" onClick={()=>window.location.reload()}><RefreshCw size={14}/> Reload</button>
          </div>
        ) : (
          <>
            <h1 className="rlm-h1">Welcome, {myTenant.name}</h1>
            <p className="rlm-sub">{myTenant.room ? `${myTenant.room} • ` : ""}Move-in {formatDate(myTenant.moveInDate)} • {isSemiMonthly(myTenant) ? "15th & 30th" : `Due ${ordinal(myTenant.dueDay)}`}</p>
            <div className="rlm-card">
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <h3 style={{ marginTop:0, fontFamily:"var(--font-display)" }}>My Information</h3>
                <button className="rlm-btn rlm-btn-ghost" style={{ padding:"4px 10px", fontSize:12 }} onClick={startEdit}>✎ Edit</button>
              </div>
              {editing ? (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, fontSize:14, marginTop:12 }}>
                  <div className="rlm-field"><label className="rlm-label">Full name *</label><input className="rlm-input" value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))} required /></div>
                  <div className="rlm-field"><label className="rlm-label">Contact</label><input className="rlm-input" value={editForm.contact} onChange={e=>setEditForm(f=>({...f,contact:e.target.value}))} /></div>
                  <div className="rlm-field"><label className="rlm-label">Room</label><input className="rlm-input" value={editForm.room} onChange={e=>setEditForm(f=>({...f,room:e.target.value}))} placeholder="e.g. Room 1" /></div>
                  <div className="rlm-field"><label className="rlm-label">Room Label</label><input className="rlm-input" value={editForm.roomLabel} onChange={e=>setEditForm(f=>({...f,roomLabel:e.target.value}))} /></div>
                  <div className="rlm-field" style={{ gridColumn:"1 / -1" }}><label className="rlm-label">Address</label><input className="rlm-input" value={editForm.address} onChange={e=>setEditForm(f=>({...f,address:e.target.value}))} placeholder="Barangay, City" /></div>
                  <div className="rlm-field"><label className="rlm-label">ID Number</label><input className="rlm-input" value={editForm.idNumber} onChange={e=>setEditForm(f=>({...f,idNumber:e.target.value}))} /></div>
                  <div className="rlm-field"><label className="rlm-label">Monthly Rent</label><input className="rlm-input" type="number" step="0.01" value={editForm.monthlyRent} onChange={e=>setEditForm(f=>({...f,monthlyRent:e.target.value}))} /></div>
                  <div className="rlm-field"><label className="rlm-label">Move-in Date</label><input className="rlm-input" type="date" value={editForm.moveInDate} onChange={e=>setEditForm(f=>({...f,moveInDate:e.target.value}))} /></div>
                  <div className="rlm-field"><label className="rlm-label">Payment Schedule</label><select className="rlm-select" value={editForm.paymentFrequency} onChange={e=>setEditForm(f=>({...f,paymentFrequency:e.target.value}))}><option value="monthly">Monthly</option><option value="semimonthly">Twice a month</option></select></div>
                  <div className="rlm-field"><label className="rlm-label">Due Day</label><input className="rlm-input" type="number" min="1" max="31" value={editForm.dueDay} onChange={e=>setEditForm(f=>({...f,dueDay:Number(e.target.value)}))} /></div>
                  <div style={{ gridColumn:"1 / -1", display:"flex", gap:8, marginTop:8 }}>
                    <button className="rlm-btn rlm-btn-primary" onClick={saveMyProfile}>Save</button>
                    <button className="rlm-btn rlm-btn-ghost" onClick={()=>setEditing(false)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, fontSize:14 }}>
                  <div><div className="rlm-label">ID Number</div>{myTenant.idNumber || "—"}</div>
                  <div><div className="rlm-label">Contact</div>{myTenant.contact || "—"}</div>
                  <div style={{ gridColumn:"1 / -1" }}><div className="rlm-label">Address</div>{myTenant.address || "—"}</div>
                  <div><div className="rlm-label">Monthly Rent</div><span className="rlm-mono">{formatMoney(myTenant.monthlyRent, settings.currency)}</span></div>
                  <div><div className="rlm-label">Room</div>{myTenant.room || "—"}</div>
                  <div><div className="rlm-label">Advance / Deposit</div>{depositSummary(myTenant, settings.currency)}</div>
                  <div><div className="rlm-label">Status</div>{myTenant.paymentFrequency==="semimonthly" ? "Twice a month" : "Monthly"}</div>
                </div>
              )}
              {(myTenant.additionalFees||[]).length>0 && <div style={{ marginTop:12, fontSize:12, color:"#5b6663" }}>Recurring: {(myTenant.additionalFees||[]).map(f=>`${f.label} ${formatMoney(f.amount, settings.currency)}`).join(", ")}</div>}
            </div>
            <div className="rlm-card" style={{ marginTop:16 }}>
              <h3 style={{ marginTop:0, fontFamily:"var(--font-display)" }}>Payment History {history.length ? `— ${history.length} paid` : ""}</h3>
              {history.length===0 ? <p style={{ fontSize:13, color:"#5b6663" }}>No payments yet. Once owner marks rent as paid, it appears here with OR & invoice.</p> : (
                <table className="rlm-table">
                  <thead><tr><th>Period</th><th>Date paid</th><th>Amount paid</th></tr></thead>
                  <tbody>
                    {history.map(h=> (
                      <tr key={h.key}><td>{h.periodLabel}</td><td className="rlm-mono">{formatDate(h.paidDate)}</td><td className="rlm-mono">{formatMoney(h.amountPaid, settings.currency)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {myTenant && history.length>0 && <div style={{ fontSize:12, color:"#5b6663", marginTop:8 }}>Total paid: <span className="rlm-mono" style={{ fontWeight:700 }}>{formatMoney(history.reduce((s,h)=>s+h.amountPaid,0), settings.currency)}</span></div>}
            </div>
            <div className="rlm-card" style={{ marginTop:16 }}>
              <h3 style={{ marginTop:0, fontFamily:"var(--font-display)" }}>My Contract</h3>
              <p style={{ fontSize:13, color:"#5b6663" }}>Your signed rental agreement (read-only).</p>
              <div className="rlm-printable" style={{ border:"1px solid var(--line)", borderRadius:6, padding:16, background:"white", fontSize:13, lineHeight:1.6 }}>
                <div style={{ textAlign:"center", fontFamily:"var(--font-display)", fontWeight:700 }}>ROOM RENTAL AGREEMENT</div>
                <div style={{ textAlign:"center", fontSize:11, color:"#5b6663", marginBottom:12 }}>Tenant: {myTenant.name} • {myTenant.room || ""} • {formatDate(myTenant.moveInDate)}</div>
                <p><strong>Landlord:</strong> {settings.landlordName || "—"} — {settings.landlordAddress || ""}</p>
                <p><strong>Tenant:</strong> {myTenant.name} ({myTenant.idNumber || "—"}) — {myTenant.address || ""}</p>
                <p><strong>Rent:</strong> {isSemiMonthly(myTenant) ? `${formatMoney(myTenant.monthlyRent, settings.currency)}/mo split 15th & 30th` : `${formatMoney(myTenant.monthlyRent, settings.currency)}/mo due ${ordinal(myTenant.dueDay)}`}</p>
                <p><strong>Advance/Deposit:</strong> {depositSummary(myTenant, settings.currency)}</p>
                <p style={{ fontSize:12, color:"#5b6663" }}>This is your copy. Ask owner for signed Official Receipt for each paid period.</p>
                <button className="rlm-btn rlm-btn-ghost no-print" style={{ marginTop:8 }} onClick={()=>window.print()}><Printer size={14}/> Print contract</button>
              </div>
            </div>
            <div style={{ marginTop:12, fontSize:11, color:"#5b6663" }}>Need help? Contact owner: {settings.landlordContact || "bedarooms@gmail.com"}</div>
          </>
        )}
      </div>
    </div>
  );
}
function formatPhone(p){ const d=String(p).replace(/\D/g,""); if(d.length===11) return d.replace(/(\d{4})(\d{3})(\d{4})/,"$1 $2 $3"); return p; }

function StatusStamp({ status, size = "sm" }) {
  const cfg = {
    paid: { label: "Paid", color: "var(--green)", Icon: CheckCircle2 },
    overdue: { label: "Overdue", color: "var(--rust)", Icon: AlertTriangle },
    due: { label: "Due", color: "var(--brass)", Icon: Clock },
  }[status] || { label: status, color: "var(--line)", Icon: Clock };
  const { label, color, Icon } = cfg;
  const dims = size === "lg" ? { w: 96, h: 96, fs: 13 } : { w: 62, h: 62, fs: 10 };
  return (
    <div style={{
      width: dims.w, height: dims.h, borderRadius: "50%", border: `2px dashed ${color}`,
      color, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      transform: "rotate(-8deg)", fontFamily: "var(--font-display)", textTransform: "uppercase",
      letterSpacing: "0.06em", fontWeight: 600, fontSize: dims.fs, gap: 2, flexShrink: 0,
    }}>
      <Icon size={size === "lg" ? 22 : 16} />
      {label}
    </div>
  );
}

export default function RoomRentalManager() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [toast, setToast] = useState(null);
  const showToast = (msg, ms=3200) => { setToast(msg); setTimeout(()=>setToast(null), ms); };
  const online = useOnline();
  const pwa = usePWA();
  const sw = useSWUpdate();
  const { session, authLoading, cloudEnabled, clearAdmin } = useSupabaseAuth();
  const [tab, setTab] = useState(() => {
    const hash = (typeof location !== "undefined" && location.hash.replace("#","")) || "";
    const ls = (()=>{ try{ return localStorage.getItem(TAB_KEY);}catch{return null}})();
    const valid = ["dashboard","tenants","payments","invoice","receipt","contract","settings"];
    if (valid.includes(hash)) return hash;
    if (valid.includes(ls)) return ls;
    return "dashboard";
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tenantForm, setTenantForm] = useState(null);
  const [selectedTenantId, setSelectedTenantId] = useState(null);
  const [invoicePeriodKey, setInvoicePeriodKey] = useState(null);
  const [receiptPeriodKey, setReceiptPeriodKey] = useState(null);
  const [payingKey, setPayingKey] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", date: todayISO() });
  const [chargesOpenKey, setChargesOpenKey] = useState(null);
  const [chargeInput, setChargeInput] = useState({ label: "", amount: "" });
  const [notesOpenKey, setNotesOpenKey] = useState(null);
  const [noteInput, setNoteInput] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // persist tab
  useEffect(()=> {
    try{ localStorage.setItem(TAB_KEY, tab); }catch{}
    if (location.hash.replace("#","") !== tab) history.replaceState(null,"","#"+tab);
    setDrawerOpen(false);
  }, [tab]);
  // handle browser back/forward hash
  useEffect(()=>{
    const onHash=()=>{ const h=location.hash.replace("#",""); const valid=["dashboard","tenants","payments","invoice","receipt","contract","settings"]; if(valid.includes(h)) setTab(h); };
    window.addEventListener("hashchange", onHash); return ()=>window.removeEventListener("hashchange", onHash);
  },[]);

  // Load from cloud if logged in, else localStorage. Re-run on auth change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await window.storage.get(STORAGE_KEY);
        if (cancelled) return;
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setData({ tenants: parsed.tenants || [], payments: parsed.payments || {}, settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) } });
        } else {
          setData({ tenants: [], payments: {}, settings: { ...DEFAULT_SETTINGS } });
        }
      } catch (e) {
        if (!cancelled) setData({ tenants: [], payments: {}, settings: { ...DEFAULT_SETTINGS } });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  async function persist(next) {
    setData(next);
    try {
      const res = await window.storage.set(STORAGE_KEY, JSON.stringify(next));
      if (!res) setSaveError(true); else setSaveError(false);
      if (!res) showToast("Storage full — try exporting and resetting data");
      return !!res;
    } catch (e) {
      setSaveError(true);
      showToast("Could not save — check storage");
      return false;
    }
  }

  const tenants = data?.tenants || [];
  const payments = data?.payments || {};
  const settings = data?.settings || DEFAULT_SETTINGS;
  const selectedTenant = useMemo(() => tenants.find(t => t.id === selectedTenantId) || null, [tenants, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId && tenants.length > 0) setSelectedTenantId(tenants[0].id);
  }, [tenants, selectedTenantId]);

  useEffect(() => { setInvoicePeriodKey(null); setPayingKey(null); setChargesOpenKey(null); setNotesOpenKey(null); }, [selectedTenantId]);

   async function saveTenant(t) {
    const currentTenants = (data?.tenants || []);
    const exists = currentTenants.some(x => x.id === t.id);
    const next = {
      tenants: exists ? currentTenants.map(x => x.id === t.id ? t : x) : [...currentTenants, t],
      payments: data?.payments || {},
      settings: data?.settings || DEFAULT_SETTINGS,
    };
    await persist(next);
    setTenantForm(null);
    if (!exists) setSelectedTenantId(t.id);
    showToast(exists ? "Tenant updated" : "Tenant added");
  }

  function deleteTenant(id) {
    const nextPayments = { ...payments };
    delete nextPayments[id];
    const next = { ...data, tenants: tenants.filter(t => t.id !== id), payments: nextPayments };
    persist(next);
    setConfirmDeleteId(null);
    if (selectedTenantId === id) setSelectedTenantId(null);
    showToast("Tenant removed");
  }

  function markPaid(tenant, period) {
    const dueDate = dueDateFor(tenant, period.year, period.month, period.half);
    const paidDateObj = new Date(paymentForm.date + "T00:00:00");
    const isLate = paidDateObj > dueDate;
    const semi = isSemiMonthly(tenant);
    const tenantPayments = payments[tenant.id] || {};
    const existing = tenantPayments[period.key] || {};
    const baseFull = Number(tenant.monthlyRent) || 0;
    const recFull = recurringTotal(tenant);
    const subtotal = (semi ? baseFull / 2 : baseFull) + (semi ? recFull / 2 : recFull) + (existing.charges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const interestApplied = (!semi && isLate) ? subtotal * 0.01 : 0;
    const rec = { ...existing, amountPaid: Number(paymentForm.amount) || 0, paidDate: paymentForm.date, interestApplied, status: "paid" };
    persist({ ...data, payments: { ...payments, [tenant.id]: { ...tenantPayments, [period.key]: rec } } });
    setPayingKey(null);
    showToast("Payment saved ✓");
  }

  function undoPaid(tenant, key) {
    const tenantPayments = { ...(payments[tenant.id] || {}) };
    const existing = tenantPayments[key] || {};
    const { amountPaid, paidDate, interestApplied, status, ...rest } = existing;
    const hasData = (rest.charges && rest.charges.length > 0) || (rest.notes && String(rest.notes).trim() !== "") || (rest.meterReadings && Object.keys(rest.meterReadings).length > 0);
    if (hasData) tenantPayments[key] = rest; else delete tenantPayments[key];
    persist({ ...data, payments: { ...payments, [tenant.id]: tenantPayments } });
    showToast("Payment undone");
  }

  function saveNote(tenant, period, text) {
    const tenantPayments = payments[tenant.id] || {};
    const existing = tenantPayments[period.key] || {};
    const rec = { ...existing, notes: text };
    persist({ ...data, payments: { ...payments, [tenant.id]: { ...tenantPayments, [period.key]: rec } } });
    setNotesOpenKey(null);
    showToast("Note saved");
  }

  function addCharge(tenant, period, label, amount) {
    if (!label.trim() || !amount) return;
    const tenantPayments = payments[tenant.id] || {};
    const existing = tenantPayments[period.key] || {};
    const charges = [...(existing.charges || []), { id: uid(), label: label.trim(), amount: Number(amount) || 0 }];
    persist({ ...data, payments: { ...payments, [tenant.id]: { ...tenantPayments, [period.key]: { ...existing, charges } } } });
    setChargeInput({ label: "", amount: "" });
    showToast("Charge added");
  }

  function removeCharge(tenant, period, chargeId) {
    const tenantPayments = payments[tenant.id] || {};
    const existing = tenantPayments[period.key] || {};
    const charges = (existing.charges || []).filter(c => c.id !== chargeId);
    persist({ ...data, payments: { ...payments, [tenant.id]: { ...tenantPayments, [period.key]: { ...existing, charges } } } });
    showToast("Charge removed");
  }

  function saveMeterReading(tenant, period, submeter, previous, current) {
    const prev = Number(previous) || 0;
    const curr = Number(current) || 0;
    const { consumption, amount } = computeMeterAmount(prev, curr, submeter.rate);
    const tenantPayments = payments[tenant.id] || {};
    const existing = tenantPayments[period.key] || {};
    const meterReadings = { ...(existing.meterReadings || {}), [submeter.id]: { previous: prev, current: curr } };
    const chargeId = meterChargeId(submeter.id);
    const otherCharges = (existing.charges || []).filter(c => c.id !== chargeId);
    const charges = [...otherCharges, { id: chargeId, label: meterChargeLabel(submeter, prev, curr, consumption), amount }];
    persist({ ...data, payments: { ...payments, [tenant.id]: { ...tenantPayments, [period.key]: { ...existing, meterReadings, charges } } } });
    showToast(`${submeter.label}: ${consumption} used → ${formatMoney(amount, settings.currency)}`);
  }

  function removeMeterReading(tenant, period, submeterId) {
    const tenantPayments = payments[tenant.id] || {};
    const existing = tenantPayments[period.key] || {};
    const meterReadings = { ...(existing.meterReadings || {}) };
    delete meterReadings[submeterId];
    const chargeId = meterChargeId(submeterId);
    const charges = (existing.charges || []).filter(c => c.id !== chargeId);
    persist({ ...data, payments: { ...payments, [tenant.id]: { ...tenantPayments, [period.key]: { ...existing, meterReadings, charges } } } });
    showToast("Reading cleared");
  }

  function saveSettings(s) { persist({ ...data, settings: s }); showToast("Settings saved"); }

  async function resetAllData() {
    const fresh = { tenants: [], payments: {}, settings: { ...DEFAULT_SETTINGS } };
    await persist(fresh);
    setSelectedTenantId(null);
    showToast("All data cleared");
  }

  async function restoreBackup(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // accept either {tenants,payments,settings} or wrapped {value:...} or full export
      let payload = parsed;
      if (payload.value) { try { payload = JSON.parse(payload.value); } catch {} }
      // if payload has tenants inside exportedAt wrapper
      if (!payload.tenants || !Array.isArray(payload.tenants)) throw new Error("Invalid backup: missing tenants");
      // prune empty payment shells like {"charges":[]} with no status/notes/meterReadings
      const rawPayments = payload.payments || {};
      const cleanedPayments = {};
      Object.entries(rawPayments).forEach(([tid, ledger]) => {
        const cleanedLedger = {};
        Object.entries(ledger || {}).forEach(([pKey, rec]) => {
          const hasPaid = rec && rec.status === "paid";
          const hasCharges = rec && Array.isArray(rec.charges) && rec.charges.length > 0;
          const hasNotes = rec && rec.notes && String(rec.notes).trim() !== "";
          const hasMeters = rec && rec.meterReadings && Object.keys(rec.meterReadings).length > 0;
          if (hasPaid || hasCharges || hasNotes || hasMeters) cleanedLedger[pKey] = rec;
        });
        if (Object.keys(cleanedLedger).length > 0) cleanedPayments[tid] = cleanedLedger;
      });
      const next = {
        tenants: payload.tenants || [],
        payments: cleanedPayments,
        settings: { ...DEFAULT_SETTINGS, ...(payload.settings || {}) },
      };
      await persist(next);
      showToast(`Restored ${next.tenants.length} tenant(s)`);
      setTab("tenants");
    } catch (e) {
      showToast("Restore failed: " + (e.message || "invalid file"));
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#EFEDE3", fontFamily: "sans-serif", color: "#1B2A28", flexDirection:"column", gap:12 }}>
        <div style={{ width:36, height:36, border:"3px solid #C9C3B0", borderTopColor:"#1B2A28", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
        <div>Loading your ledger…</div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const navItems = [
    { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
    { id: "tenants", label: "Tenants", Icon: Users },
    { id: "payments", label: "Payments", Icon: Receipt },
    { id: "invoice", label: "Invoice", Icon: FileText },
    { id: "receipt", label: "Official Receipt", Icon: Receipt },
    { id: "contract", label: "Contract", Icon: FileText },
    { id: "settings", label: "Settings", Icon: SettingsIcon },
  ];

  // Auth gate — nobody can open the PWA without signing in when cloud is enabled
  if (cloudEnabled && authLoading) {
    return (
      <div style={{ minHeight:"100dvh", display:"flex", alignItems:"center", justifyContent:"center", background:"#EFEDE3", fontFamily:"sans-serif", color:"#1B2A28", flexDirection:"column", gap:12 }}>
        <div style={{ width:32, height:32, border:"3px solid #C9C3B0", borderTopColor:"#1B2A28", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
        <div>Checking login…</div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
  if (!session) {
    return <LoginGate session={session} showToast={showToast} saveTenant={saveTenant} />;
  }
  if (isRenterSession(session)) {
    if (loading) {
      return (
        <div style={{ minHeight:"100dvh", display:"flex", alignItems:"center", justifyContent:"center", background:"#EFEDE3", fontFamily:"sans-serif", color:"#1B2A28", flexDirection:"column", gap:12 }}>
          <div style={{ width:32, height:32, border:"3px solid #C9C3B0", borderTopColor:"#1B2A28", borderRadius:"50%", animation:"spin 0.8s linear infinite" }} />
          <div>Loading your rental…</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      );
    }
    const renterPhone = session?.user?.phone || null;
    const renterTenant = tenants.find(t => {
      if (!renterPhone) return false;
      const c = String(t.contact||"").replace(/\D/g,"");
      return c && c === renterPhone.replace(/\D/g,"");
    }) || null;
    const renterPayments = renterTenant ? (payments[renterTenant.id] || {}) : {};
    const renterPaymentList = Object.entries(renterPayments).flatMap(([key, rec]) => ({
      id: key, period: key, status: rec.status, amount: rec.amountPaid, paidAt: rec.paidDate, dueDate: rec.dueDate, tenantId: renterTenant.id, paymentMethod: rec.paymentMethod || null
    }));

    function markPaidOnline(tenant, periodKey, method) {
      if (!tenant || !tenant.id) return false;
      const tenantPayments = { ...(data.payments[tenant.id] || {}) };
      const existing = tenantPayments[periodKey] || {};
      const now = new Date().toISOString().slice(0, 10);
      const { year, month, half } = parsePeriodKey(periodKey);
      const dueDate = dueDateFor(tenant, year, month, half);
      const isLate = new Date() > dueDate;
      const semi = isSemiMonthly(tenant);
      const baseFull = Number(tenant.monthlyRent) || 0;
      const recFull = recurringTotal(tenant);
      const subtotal = (semi ? baseFull / 2 : baseFull) + (semi ? recFull / 2 : recFull) + (existing.charges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
      const interestApplied = (!semi && isLate) ? subtotal * 0.01 : 0;
      tenantPayments[periodKey] = {
        ...existing,
        amountPaid: Number(existing.amountPaid) || Number(subtotal) || Number(tenant.monthlyRent),
        paidDate: now,
        interestApplied,
        status: "paid",
        paymentMethod: method
      };
      const nextData = { ...data, payments: { ...data.payments, [tenant.id]: tenantPayments } };
      persist(nextData);
      return true;
    }

    return <RenterDashboard
      tenant={renterTenant}
      payments={renterPaymentList}
      settings={settings}
      onSignOut={async()=>{ try{ localStorage.removeItem("rlm:renter-auth"); localStorage.removeItem("rlm:admin-auth"); }catch{} try{ await window.storage.signOut(); }catch{} window.location.reload(); }}
      isOnline={online}
      onPayOnline={markPaidOnline}
    />;
  }

  return (
    <div className="rlm-app">
      {/* Topbar for mobile */}
      <div className="rlm-topbar no-print">
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button aria-label="Open navigation menu" onClick={()=>setDrawerOpen(true)}><Menu size={18} /> Menu</button>
          <span style={{ fontFamily:"var(--font-display)", fontWeight:600 }}>BeDa Rooms</span>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
           {session?.user && <span style={{ fontSize:11, background:"rgba(255,255,255,0.15)", padding:"4px 8px", borderRadius:4 }} title={session.user.email}>{session.user.email.split("@")[0]}</span>}
           {!online && <span style={{ fontSize:11, background:"rgba(255,255,255,0.15)", padding:"4px 8px", borderRadius:4, display:"inline-flex", alignItems:"center", gap:4 }}><WifiOff size={12}/> Offline</span>}
           {pwa.canInstall && <button type="button" onClick={pwa.prompt} style={{ background:"var(--brass)", color:"white", border:"none" }}><Smartphone size={14}/> Install</button>}
           {session?.user && <button type="button" onClick={async()=>{
             try { localStorage.removeItem(ADMIN_KEY); localStorage.removeItem(RENTER_KEY); } catch {}
             try { await Promise.race([window.storage.signOut(), new Promise((_,rej)=>setTimeout(()=>rej(new Error("t")), 3500))]); } catch {}
             try { await clearAdmin?.(); } catch {}
             try { showToast("Signed out"); } catch {}
             window.location.reload();
           }} style={{ background:"rgba(255,255,255,0.12)", color:"white", border:"1px solid rgba(255,255,255,0.2)", padding:"4px 8px", borderRadius:4, display:"inline-flex", alignItems:"center", gap:4, cursor:"pointer", position:"relative", zIndex:1 }}><LogOut size={12}/> Sign out</button>}
         </div>
      </div>

      {/* Sidebar */}
      <nav className={`rlm-sidebar no-print ${drawerOpen ? "open" : ""}`} aria-label="Main navigation" id="rlm-sidebar">
        <div className="rlm-brand">BeDa Rooms<span>Rental Management • v{APP_VERSION}</span></div>
        {navItems.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`rlm-nav-item ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
            aria-current={tab===id ? "page" : undefined}
            style={{ background:"transparent", border:"none", borderLeft: tab===id ? "3px solid var(--brass)" : "3px solid transparent", textAlign:"left", width:"100%" }}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
        {session?.user && (
          <button
            type="button"
            className="rlm-nav-item"
            onClick={async()=>{
              try { localStorage.removeItem(ADMIN_KEY); localStorage.removeItem(RENTER_KEY); } catch {}
              try { await Promise.race([window.storage.signOut(), new Promise((_,rej)=>setTimeout(()=>rej(new Error("t")), 3500))]); } catch {}
              try { await clearAdmin?.(); } catch {}
              try { showToast("Signed out"); } catch {}
              window.location.reload();
            }}
            style={{ background:"transparent", border:"none", borderLeft:"3px solid transparent", textAlign:"left", width:"100%", color:"rgba(248,246,239,0.85)", marginTop:8 }}
          >
            <LogOut size={16}/> Sign out
          </button>
        )}
        <div style={{ marginTop:"auto", padding:"14px 20px", borderTop:"1px solid rgba(255,255,255,0.12)", fontSize:11, color:"rgba(248,246,239,0.6)", fontFamily:"var(--font-mono)" }}>
           <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:6 }}>
             <Home size={12}/> {tenants.length} tenant{tenants.length===1?"":"s"} • {online ? "Online" : "Offline"}
           </div>
           <div style={{ opacity:0.7 }}>{cloudEnabled ? (session?.user ? `Cloud ${session.user.email}` : "Cloud ready — sign in") : "Local only"}</div>
           <div style={{ opacity:0.7 }}>{pwa.isStandalone ? "Installed ✓" : "Add to Home Screen for offline use"}</div>
         </div>
      </nav>
      {drawerOpen && <div className="rlm-drawer-overlay" onClick={()=>setDrawerOpen(false)} aria-hidden="true" />}

      <div className="rlm-main">
        <AuthPanel session={session} showToast={showToast} />
        {!cloudEnabled && online && (
          <div className="no-print" style={{ background:"#FFF3CD", border:"1px solid #FFE69C", color:"#664D03", padding:"8px 12px", borderRadius:4, marginBottom:12, fontSize:12 }}>
            Local-only mode — data on this device only. Configure Supabase to sync across devices (see Settings).
          </div>
        )}
        {!online && (
          <div className="rlm-offline-bar no-print" role="status"><WifiOff size={12} style={{ verticalAlign:"middle", marginRight:6 }}/> You are offline — data is saved locally and will sync when you reconnect. Invoices & contracts still work.</div>
        )}
        {sw.offlineReady && (
          <div className="rlm-update-banner no-print" role="status">
            <span><CheckCircle2 size={14} style={{ verticalAlign:"middle", marginRight:6 }}/> App ready for offline use.</span>
            <button className="rlm-btn rlm-btn-ghost" style={{ padding:"4px 10px" }} onClick={sw.dismiss}>Dismiss</button>
          </div>
        )}
        {sw.needRefresh && (
          <div className="rlm-update-banner no-print" role="alert">
            <span><RefreshCw size={14} style={{ verticalAlign:"middle", marginRight:6 }}/> New version available.</span>
            <div style={{ display:"flex", gap:8 }}>
              <button className="rlm-btn rlm-btn-primary" style={{ padding:"6px 12px" }} onClick={sw.reload}>Update now</button>
              <button className="rlm-btn rlm-btn-ghost" style={{ padding:"6px 12px" }} onClick={sw.dismiss}>Later</button>
            </div>
          </div>
        )}
        {pwa.canInstall && !pwa.isStandalone && (
          <div className="rlm-install-banner no-print">
            <span><Smartphone size={14} style={{ verticalAlign:"middle", marginRight:6 }}/> Install BeDa Rooms on your device for one-tap access & offline use.</span>
            <div style={{ display:"flex", gap:8 }}>
              <button className="rlm-btn rlm-btn-brass" style={{ padding:"6px 14px" }} onClick={async()=>{ const ok=await pwa.prompt(); if(ok) showToast("Thanks — install started"); }}>Install</button>
              <button className="rlm-btn rlm-btn-ghost" style={{ padding:"6px 10px", color:"white", borderColor:"rgba(255,255,255,0.3)" }} onClick={()=>showToast("You can install later from your browser menu → Install app")}>Not now</button>
            </div>
          </div>
        )}
        {saveError && (
          <div className="no-print" style={{ background: "#F6E3DE", border: "1px solid var(--rust)", color: "var(--rust)", padding: "10px 14px", borderRadius: 4, marginBottom: 16, fontSize: 13 }}>
            Couldn't save your last change — storage may be full. Export a backup, then reset.
          </div>
        )}

        {tab === "dashboard" && (
          <Dashboard tenants={tenants} payments={payments} settings={settings} onGoTenants={() => setTab("tenants")} showToast={showToast} />
        )}

        {tab === "tenants" && (
          <TenantsTab
            tenants={tenants}
            tenantForm={tenantForm}
            setTenantForm={setTenantForm}
            saveTenant={saveTenant}
            settings={settings}
            confirmDeleteId={confirmDeleteId}
            setConfirmDeleteId={setConfirmDeleteId}
            deleteTenant={deleteTenant}
          />
        )}

        {tab === "payments" && (
          <PaymentsTab
            tenants={tenants} payments={payments} settings={settings}
            selectedTenant={selectedTenant} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId}
            payingKey={payingKey} setPayingKey={setPayingKey}
            paymentForm={paymentForm} setPaymentForm={setPaymentForm}
            chargesOpenKey={chargesOpenKey} setChargesOpenKey={setChargesOpenKey}
            chargeInput={chargeInput} setChargeInput={setChargeInput}
            notesOpenKey={notesOpenKey} setNotesOpenKey={setNotesOpenKey}
            noteInput={noteInput} setNoteInput={setNoteInput} saveNote={saveNote}
            addCharge={addCharge} removeCharge={removeCharge}
            saveMeterReading={saveMeterReading} removeMeterReading={removeMeterReading}
            markPaid={markPaid} undoPaid={undoPaid}
            goInvoice={(key) => { setInvoicePeriodKey(key); setTab("invoice"); }}
            goReceipt={(key) => { setReceiptPeriodKey(key); setTab("receipt"); }}
          />
        )}

        {tab === "invoice" && (
          <InvoiceTab
            tenants={tenants} payments={payments} settings={settings}
            selectedTenant={selectedTenant} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId}
            invoicePeriodKey={invoicePeriodKey} setInvoicePeriodKey={setInvoicePeriodKey}
          />
        )}

        {tab === "receipt" && (
          <OfficialReceiptTab
            tenants={tenants} payments={payments} settings={settings}
            selectedTenant={selectedTenant} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId}
            receiptPeriodKey={receiptPeriodKey} setReceiptPeriodKey={setReceiptPeriodKey}
          />
        )}

        {tab === "contract" && (
          <ContractTab
            tenants={tenants} settings={settings}
            selectedTenant={selectedTenant} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId}
          />
        )}

        {tab === "settings" && (
          <SettingsTab settings={settings} saveSettings={saveSettings} onReset={resetAllData} tenants={tenants} payments={payments} onRestore={restoreBackup} />
        )}

        <footer className="no-print" style={{ marginTop:32, paddingTop:16, borderTop:"1px solid var(--line)", fontSize:11, color:"#5b6663", fontFamily:"var(--font-mono)", display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
           <span>BeDa Rooms v{APP_VERSION} • PWA offline-ready • {cloudEnabled ? (session?.user ? `Cloud synced as ${session.user.email}` : "Cloud ready — sign in for sync") : "Local only"}</span>
           <span>{tenants.length} tenants • {Object.keys(payments).length} payment ledgers</span>
         </footer>
      </div>

      {toast && <div className="rlm-toast no-print" role="status" aria-live="polite"><CheckCircle2 size={16}/> {toast}</div>}
    </div>
  );
}

function RenterIntakeCard({ showToast }) {
  const [text, setText] = useState(loadIntakeTemplate);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const persistText = (v) => {
    setText(v);
    try { localStorage.setItem(INTAKE_KEY, v); } catch {}
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback for older browsers / non-secure context
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    try { showToast?.("Info request copied — ready to paste"); } catch {}
    setTimeout(() => setCopied(false), 2000);
  };

  const smsHref = `sms:?&body=${encodeURIComponent(text)}`;
  const emailHref = `mailto:?subject=${encodeURIComponent("BeDa Rooms — Renter Information")}&body=${encodeURIComponent(text)}`;
  const reset = () => {
    persistText(RENTER_INTAKE_TEMPLATE);
    try { showToast?.("Template reset"); } catch {}
  };

  const sendViaMessenger = async () => {
    await copyText();
    // Messenger has no official pre-filled-text URL, so copy first then open Messenger
    window.open("https://www.messenger.com/", "_blank", "noopener");
  };

  const shareNative = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "BeDa Rooms — Renter Information", text }); return; }
      catch { /* user cancelled — fall through */ }
    }
    copyText();
  };

  return (
    <div className="rlm-card no-print" style={{ borderColor: "var(--brass)", marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{ background: "transparent", border: "none", width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", padding: 0, textAlign: "left" }}
      >
        <span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 700, fontFamily: "var(--font-display)" }}>
            <Send size={16} /> New Renter Info Request
          </span>
          <span style={{ display: "block", fontSize: 12, color: "#5b6663", marginTop: 4 }}>
            {open ? "Tap to collapse" : "Ready-to-send onboarding form — SMS, email, or Messenger"} • {text.length} chars
          </span>
        </span>
        <ChevronDown size={18} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <textarea
            className="rlm-input"
            rows={14}
            value={text}
            onChange={e => persistText(e.target.value)}
            aria-label="Renter info request message (editable)"
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button type="button" className="rlm-btn rlm-btn-primary" onClick={copyText}>
              <Copy size={14} /> {copied ? "Copied ✓" : "Copy text"}
            </button>
            <a className="rlm-btn rlm-btn-ghost" href={smsHref} style={{ textDecoration: "none" }}>
              <MessageSquareText size={14} /> Text / SMS
            </a>
            <a className="rlm-btn rlm-btn-ghost" href={emailHref} style={{ textDecoration: "none" }}>
              <Mail size={14} /> Email
            </a>
            <button type="button" className="rlm-btn rlm-btn-ghost" onClick={sendViaMessenger} title="Copies the text, then opens Messenger so you can paste it">
              <Send size={14} /> Messenger
            </button>
            {typeof navigator !== "undefined" && navigator.share && (
              <button type="button" className="rlm-btn rlm-btn-ghost" onClick={shareNative}>
                <Send size={14} /> Share…
              </button>
            )}
            <button type="button" className="rlm-btn rlm-btn-ghost" onClick={reset} title="Restore original wording">
              <RotateCcw size={14} /> Reset
            </button>
          </div>
          <p style={{ fontSize: 11, color: "#5b6663", marginTop: 8, marginBottom: 0 }}>
            Tip: <strong>Text / SMS</strong> and <strong>Email</strong> open your messaging app with the form pre-filled.
            <strong> Messenger</strong> has no pre-fill API, so it copies the form first — then just paste it into the chat.
            Edits auto-save on this device.
          </p>
        </div>
      )}
    </div>
  );
}

function Dashboard({ tenants, payments, settings, onGoTenants, showToast }) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const [query, setQuery] = useState("");
  const rows = tenants.flatMap(t => {
    const halves = isSemiMonthly(t) ? ["a", "b"] : [null];
    return halves.map(half => ({ tenant: t, half, info: getPeriodInfo(t, payments, y, m, half) }));
  });
  const filteredRows = rows.filter(({tenant})=>{
    if (!query.trim()) return true;
    const q=query.toLowerCase();
    return tenant.name.toLowerCase().includes(q) || (tenant.room||"").toLowerCase().includes(q) || (tenant.idNumber||"").toLowerCase().includes(q);
  });
  const collected = rows.filter(r => r.info.status === "paid").reduce((s, r) => s + r.info.amountPaid, 0);
  const overdueTotal = rows.filter(r => r.info.status === "overdue").reduce((s, r) => s + r.info.total, 0);
  const overdueCount = rows.filter(r => r.info.status === "overdue").length;

  const history = useMemo(() => getAllPaymentHistory(tenants, payments), [tenants, payments]);
  const filteredHistory = useMemo(()=>{
    if(!query.trim()) return history;
    const q=query.toLowerCase();
    return history.filter(h=> h.tenantName.toLowerCase().includes(q) || h.room.toLowerCase().includes(q));
  }, [history, query]);

  function downloadHistoryCSV() {
    const csvRows = [["Date paid", "Tenant", "Room", "Period", "Amount paid", "Notes"]];
    filteredHistory.forEach(h => csvRows.push([h.paidDate, h.tenantName, h.room, h.periodLabel, h.amountPaid.toFixed(2), h.notes]));
    downloadFile(`payment-history-${todayISO()}.csv`, toCSV(csvRows), "text/csv;charset=utf-8;");
  }

  // Yearly income — owner summary
  const yearly = useMemo(()=>{
    const map = {};
    history.forEach(h=>{
      const yr = h.paidDate ? Number(String(h.paidDate).slice(0,4)) : null;
      if (!yr) return;
      if (!map[yr]) map[yr] = { year: yr, total: 0, count: 0, byMonth: Array(12).fill(0), byTenant: {} };
      map[yr].total += Number(h.amountPaid)||0;
      map[yr].count += 1;
      const mo = Number(String(h.paidDate).slice(5,7))-1;
      if (mo>=0 && mo<12) map[yr].byMonth[mo] += Number(h.amountPaid)||0;
      map[yr].byTenant[h.tenantName] = (map[yr].byTenant[h.tenantName]||0) + Number(h.amountPaid)||0;
    });
    return Object.values(map).sort((a,b)=>b.year - a.year);
  }, [history]);
  const [yearSel, setYearSel] = useState(()=> new Date().getFullYear());
  const yearData = useMemo(()=> yearly.find(x=>x.year===yearSel) || yearly[0] || null, [yearly, yearSel]);
  const allYears = yearly.map(x=>x.year);
  if (allYears.length && !allYears.includes(yearSel) && yearly.length) {
    // keep controlled if data loads later — handled via effect below would cause set during render, so just default
  }
  function downloadYearCSV() {
    if (!yearData) return;
    const rows = [["Month","Income"],["January",yearData.byMonth[0]],["February",yearData.byMonth[1]],["March",yearData.byMonth[2]],["April",yearData.byMonth[3]],["May",yearData.byMonth[4]],["June",yearData.byMonth[5]],["July",yearData.byMonth[6]],["August",yearData.byMonth[7]],["September",yearData.byMonth[8]],["October",yearData.byMonth[9]],["November",yearData.byMonth[10]],["December",yearData.byMonth[11]]];
    downloadFile(`yearly-income-${yearData.year}.csv`, toCSV(rows), "text/csv;charset=utf-8;");
  }

  return (
    <div>
      <h1 className="rlm-h1">Dashboard</h1>
      <p className="rlm-sub">{MONTHS[m - 1]} {y} at a glance • {pwaHint()}</p>
      <div className="rlm-search" style={{ position:"relative" }}>
        <Search size={14} style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#5b6663" }}/>
        <input className="rlm-input" style={{ paddingLeft:30 }} placeholder="Search tenants, rooms, IDs…" value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search dashboard" />
      </div>

      <div className="rlm-grid-stats">
        <div className="rlm-card"><div className="rlm-stat-label">Tenants</div><div className="rlm-stat-value">{tenants.length}</div></div>
        <div className="rlm-card"><div className="rlm-stat-label">Collected this month</div><div className="rlm-stat-value" style={{ color: "var(--green)" }}>{formatMoney(collected, settings.currency)}</div></div>
        <div className="rlm-card"><div className="rlm-stat-label">Overdue</div><div className="rlm-stat-value" style={{ color: overdueCount ? "var(--rust)" : "inherit" }}>{overdueCount} bill{overdueCount === 1 ? "" : "s"}</div></div>
        <div className="rlm-card"><div className="rlm-stat-label">Overdue amount</div><div className="rlm-stat-value" style={{ color: overdueTotal ? "var(--rust)" : "inherit" }}>{formatMoney(overdueTotal, settings.currency)}</div></div>
      </div>

      <RenterIntakeCard showToast={showToast} />

      <div className="rlm-card">
        {tenants.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <p style={{ marginBottom: 14 }}>No tenants yet. Add your first tenant to start tracking rent.</p>
            <button className="rlm-btn rlm-btn-primary" onClick={onGoTenants}><Plus size={15} /> Add a tenant</button>
          </div>
        ) : filteredRows.length===0 ? (
          <p style={{ textAlign:"center", padding:"20px 0", color:"#5b6663" }}>No tenants match "{query}"</p>
        ) : (
          <table className="rlm-table">
            <thead><tr><th>Tenant</th><th>Rent + charges</th><th>This period's due</th><th>Status</th></tr></thead>
            <tbody>
              {filteredRows.map(({ tenant, half, info }) => (
                <tr key={tenant.id + (half || "")}>
                  <td>{tenant.name}{tenant.room && <span style={{ fontSize: 12, color: "#5b6663" }}> — {tenant.room}</span>}{half && <span style={{ fontSize: 12, color: "#5b6663" }}> ({halfLabel(half)})</span>}</td>
                  <td className="rlm-mono">{formatMoney(info.subtotal, settings.currency)}</td>
                  <td className="rlm-mono">{formatMoney(info.total, settings.currency)}{info.interest > 0 && <span style={{ color: "var(--rust)", fontSize: 12 }}> (+1% late)</span>}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
                        color: info.status === "paid" ? "var(--green)" : info.status === "overdue" ? "var(--rust)" : "var(--brass)"
                      }}>{info.status}</span>
                      {info.paymentMethod && (
                        <span style={{ fontSize: 10, background: '#f0e4cc', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', color: '#ad8a4e' }}>
                          {info.paymentMethod}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {tenants.length > 0 && (
        <div className="rlm-card" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Payment history {query && `— filtered: ${filteredHistory.length}`}</h2>
            {filteredHistory.length > 0 && (
              <button className="rlm-btn rlm-btn-ghost" onClick={downloadHistoryCSV}><Download size={14} /> Download history (CSV)</button>
            )}
          </div>
          {filteredHistory.length === 0 ? (
            <p style={{ fontSize: 13, color: "#5b6663" }}>{query ? `No payments match "${query}"` : "No payments recorded yet. Once you mark periods as paid, every payment will show up here."}</p>
          ) : (
            <table className="rlm-table">
<thead><tr><th>Date paid</th><th>Tenant</th><th>Period</th><th>Amount paid</th><th>Method</th></tr></thead>
               <tbody>
                 {filteredHistory.map((h, i) => (
                   <tr key={h.tenantId + h.periodLabel + i}>
                     <td className="rlm-mono">{formatDate(h.paidDate)}</td>
                     <td>{h.tenantName}{h.room && <span style={{ fontSize: 12, color: "#5b6663" }}> — {h.room}</span>}</td>
                     <td>{h.periodLabel}</td>
                     <td className="rlm-mono">{formatMoney(h.amountPaid, settings.currency)}</td>
                     <td>{h.paymentMethod ? <span style={{ fontSize: 10, background: '#f0e4cc', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', color: '#ad8a4e' }}>{h.paymentMethod}</span> : '—'}</td>
                   </tr>
                 ))}
               </tbody>
            </table>
          )}
        </div>
      )}

      {/* Yearly Income — owner summary */}
      <div className="rlm-card" style={{ marginTop: 16, borderColor: yearly.length ? "var(--ink)" : undefined }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10, marginBottom:12 }}>
          <h2 style={{ margin:0, fontSize:16 }}>Yearly Income — Owner Summary</h2>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <select className="rlm-select" style={{ minWidth:110 }} value={yearSel} onChange={e=>setYearSel(Number(e.target.value))}>
              {[...new Set([...allYears, new Date().getFullYear()])].sort((a,b)=>b-a).map(yr=> <option key={yr} value={yr}>{yr}</option>)}
            </select>
            {yearData && <button className="rlm-btn rlm-btn-ghost" style={{ padding:"6px 10px" }} onClick={downloadYearCSV}><Download size={14}/> Year CSV</button>}
            <button className="rlm-btn rlm-btn-ghost" style={{ padding:"6px 10px" }} onClick={()=>window.print()}><Printer size={14}/> Print</button>
          </div>
        </div>
        {yearly.length === 0 ? (
          <p style={{ fontSize:13, color:"#5b6663" }}>No paid rent yet — yearly totals will appear here once you mark periods as Paid. This summary is owner-only.</p>
        ) : (
          <>
            <div className="rlm-grid-stats" style={{ marginBottom:12 }}>
              <div className="rlm-card" style={{ background:"#F4F1E7" }}><div className="rlm-stat-label">{yearData ? yearData.year : yearSel} total</div><div className="rlm-stat-value" style={{ color:"var(--green)" }}>{yearData ? formatMoney(yearData.total, settings.currency) : formatMoney(0, settings.currency)}</div><div style={{ fontSize:11, color:"#5b6663" }}>{yearData ? `${yearData.count} payment(s) • avg ${formatMoney(yearData.total/12, settings.currency)}/mo` : "—"}</div></div>
              <div className="rlm-card"><div className="rlm-stat-label">All-time total</div><div className="rlm-stat-value">{formatMoney(yearly.reduce((s,x)=>s+x.total,0), settings.currency)}</div><div style={{ fontSize:11, color:"#5b6663" }}>{yearly.reduce((s,x)=>s+x.count,0)} payments across {yearly.length} year(s)</div></div>
              <div className="rlm-card"><div className="rlm-stat-label">Best month ({yearData?.year || ""})</div><div className="rlm-stat-value">{yearData ? `${MONTHS[yearData.byMonth.indexOf(Math.max(...yearData.byMonth))]?.slice(0,3)} — ${formatMoney(Math.max(...yearData.byMonth), settings.currency)}` : "—"}</div></div>
            </div>
            {yearData ? (
              <>
                <div style={{ overflowX:"auto", marginBottom:12 }}>
                  <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:90, minWidth: 520, padding:"8px 0" }}>
                    {yearData.byMonth.map((v,i)=>{
                      const max = Math.max(...yearData.byMonth, 1);
                      const h = Math.round((v/max)*72);
                      return (
                        <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                          <div title={`${MONTHS[i]}: ${formatMoney(v, settings.currency)}`} style={{ width:"100%", height: h, background: v ? "var(--ink)" : "#E8E6E0", borderRadius:4, minHeight:4 }} />
                          <span style={{ fontSize:10, color:"#5b6663" }}>{MONTHS[i].slice(0,3)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <table className="rlm-table" style={{ marginBottom:10 }}>
                  <thead><tr><th>Month</th><th style={{ textAlign:"right" }}>Income</th><th style={{ textAlign:"right" }}>Share</th></tr></thead>
                  <tbody>
                    {yearData.byMonth.map((v,i)=> (
                      <tr key={i} style={{ opacity: v ? 1 : 0.5 }}><td>{MONTHS[i]}</td><td className="rlm-mono" style={{ textAlign:"right" }}>{formatMoney(v, settings.currency)}</td><td style={{ textAlign:"right", fontSize:12, color:"#5b6663" }}>{yearData.total ? `${((v/yearData.total)*100).toFixed(1)}%` : "—"}</td></tr>
                    ))}
                    <tr style={{ fontWeight:700, background:"#F4F1E7" }}><td>Total {yearData.year}</td><td className="rlm-mono" style={{ textAlign:"right" }}>{formatMoney(yearData.total, settings.currency)}</td><td></td></tr>
                  </tbody>
                </table>
                <div style={{ fontSize:12, color:"#5b6663", marginBottom:8 }}>By tenant ({yearData.year}):</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:8 }}>
                  {Object.entries(yearData.byTenant).sort((a,b)=>b[1]-a[1]).map(([name, amt])=> (
                    <span key={name} style={{ background:"white", border:"1px solid var(--line)", borderRadius:20, padding:"4px 10px", fontSize:12 }}>{name} — <span className="rlm-mono" style={{ fontWeight:600 }}>{formatMoney(amt, settings.currency)}</span></span>
                  ))}
                </div>
                <table className="rlm-table">
                  <thead><tr><th>Year</th><th>Payments</th><th style={{ textAlign:"right" }}>Total income</th></tr></thead>
                  <tbody>
                    {yearly.map(y=> (
                      <tr key={y.year} style={{ background: y.year===yearData.year ? "#F4F1E7" : "transparent", fontWeight: y.year===yearData.year ? 600 : 400 }}>
                        <td>{y.year}</td><td>{y.count}</td><td className="rlm-mono" style={{ textAlign:"right" }}>{formatMoney(y.total, settings.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <p style={{ fontSize:13, color:"#5b6663" }}>No income for {yearSel} yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
function pwaHint(){ return "Offline-ready PWA"; }

function TenantsTab({ tenants, tenantForm, setTenantForm, saveTenant, settings, confirmDeleteId, setConfirmDeleteId, deleteTenant }) {
  const [query, setQuery] = useState("");
  const filtered = tenants.filter(t=>{
    if(!query.trim()) return true;
    const q=query.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.room||"").toLowerCase().includes(q) || (t.idNumber||"").toLowerCase().includes(q) || (t.address||"").toLowerCase().includes(q);
  });
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, gap:12, flexWrap:"wrap" }}>
        <div>
          <h1 className="rlm-h1">Tenants</h1>
          <p className="rlm-sub" style={{ marginBottom: 0 }}>Room assignments, IDs, addresses, rent, and recurring charges.</p>
        </div>
        {!tenantForm && <button className="rlm-btn rlm-btn-primary" onClick={() => setTenantForm("new")}><Plus size={15} /> Add tenant</button>}
      </div>

      {!tenantForm && (
        <div className="rlm-search" style={{ position:"relative" }}>
          <Search size={14} style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#5b6663" }}/>
          <input className="rlm-input" style={{ paddingLeft:30 }} placeholder="Search by name, room, ID, address…" value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search tenants" />
        </div>
      )}

      {tenantForm && (
        <TenantForm initial={tenantForm === "new" ? null : tenantForm} tenants={tenants} onSave={saveTenant} onCancel={() => setTenantForm(null)} />
      )}

      {!tenantForm && (
        <div className="rlm-card">
          {filtered.length === 0 ? (
            <p style={{ textAlign: "center", padding: "20px 0", color: "#5b6663" }}>{tenants.length===0 ? "No tenants added yet." : `No tenants match "${query}"`}</p>
          ) : (
            <table className="rlm-table">
              <thead><tr><th>Room</th><th>Name</th><th>ID no.</th><th>Address</th><th>Rent</th><th>Recurring</th><th>Advance / deposit</th><th>Schedule</th><th></th></tr></thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id}>
                    <td style={{ fontWeight: 600 }}>{t.room || "—"}</td>
                    <td>{t.name}</td>
                    <td className="rlm-mono">{t.idNumber || "—"}</td>
                    <td>{t.address || "—"}</td>
                    <td className="rlm-mono">{formatMoney(t.monthlyRent, settings.currency)}</td>
                    <td style={{ fontSize: 12 }}>
                      {(t.additionalFees || []).length === 0 ? "—" : t.additionalFees.map(f => `${f.label} ${formatMoney(f.amount, settings.currency)}`).join(", ")}
                    </td>
                    <td style={{ fontSize: 12 }}>{depositSummary(t, settings.currency)}</td>
                    <td style={{ fontSize: 12 }}>{isSemiMonthly(t) ? "15th & 30th" : `Due ${ordinal(t.dueDay)}`}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="rlm-btn rlm-btn-ghost" style={{ padding: 6, marginRight: 6 }} onClick={() => setTenantForm(t)} aria-label={`Edit ${t.name}`}><Pencil size={14} /></button>
                      {confirmDeleteId === t.id ? (
                        <>
                          <button className="rlm-btn rlm-btn-danger" style={{ padding: "6px 10px" }} onClick={() => deleteTenant(t.id)}>Confirm</button>
                          <button className="rlm-btn rlm-btn-ghost" style={{ padding: "6px 10px", marginLeft: 6 }} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                        </>
                      ) : (
                        <button className="rlm-btn rlm-btn-ghost" style={{ padding: 6 }} onClick={() => setConfirmDeleteId(t.id)} aria-label={`Delete ${t.name}`}><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function TenantForm({ initial, tenants = [], onSave, onCancel }) {
  const [form, setForm] = useState(initial || { name: "", room: "", idNumber: "", address: "", contact: "", monthlyRent: "", dueDay: 1, moveInDate: todayISO(), additionalFees: [], submeters: [], depositType: "none", advanceAmount: "", depositAmount: "", depositNotes: "", paymentFrequency: "monthly" });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const rentNum = Number(form.monthlyRent);
  const valid = form.name.trim() && form.moveInDate && rentNum > 0;
  const dueDayNum = Number(form.dueDay);
  const dueDayValid = dueDayNum >=1 && dueDayNum <=31;
  const depositType = form.depositType || "none";
  const needsAdvance = depositType === "advance" || depositType === "both";
  const needsDeposit = depositType === "deposit" || depositType === "both";
  const paymentFrequency = form.paymentFrequency || "monthly";
  const semi = paymentFrequency === "semimonthly";
  const occupant = form.room ? tenants.find(t => t.room === form.room && t.id !== form.id) : null;

  function addFeeRow() {
    setForm(f => ({ ...f, additionalFees: [...(f.additionalFees || []), { id: uid(), label: "", amount: "" }] }));
  }
  function updateFeeRow(id, key, value) {
    setForm(f => ({ ...f, additionalFees: f.additionalFees.map(x => x.id === id ? { ...x, [key]: value } : x) }));
  }
  function removeFeeRow(id) {
    setForm(f => ({ ...f, additionalFees: f.additionalFees.filter(x => x.id !== id) }));
  }

  function addSubmeterRow() {
    setForm(f => ({ ...f, submeters: [...(f.submeters || []), { id: uid(), label: "", unit: "", rate: "" }] }));
  }
  function updateSubmeterRow(id, key, value) {
    setForm(f => ({ ...f, submeters: f.submeters.map(x => x.id === id ? { ...x, [key]: value } : x) }));
  }
  function removeSubmeterRow(id) {
    setForm(f => ({ ...f, submeters: f.submeters.filter(x => x.id !== id) }));
  }

  return (
    <div className="rlm-card" style={{ marginBottom: 24 }}>
      <h3 style={{ fontFamily: "var(--font-display)", marginTop: 0 }}>{initial ? "Edit tenant" : "New tenant"}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="rlm-field"><label className="rlm-label">Full name *</label><input className="rlm-input" required value={form.name} onChange={e => set("name", e.target.value)} placeholder="Juan Dela Cruz" aria-required="true" /></div>
        <div className="rlm-field">
          <label className="rlm-label">Room</label>
          <select className="rlm-select" value={form.room || ""} onChange={e => set("room", e.target.value)}>
            <option value="">— Select room —</option>
            {ROOMS.map(r => {
              const takenBy = tenants.find(t => t.room === r && t.id !== form.id);
              return <option key={r} value={r}>{r}{takenBy ? ` — occupied by ${takenBy.name}` : ""}</option>;
            })}
          </select>
          {occupant && (
            <p style={{ fontSize: 12, color: "var(--rust)", marginTop: 6, marginBottom: 0 }}>
              Heads up: {occupant.name} is already recorded in {form.room}. Saving will leave both tenants assigned to this room.
            </p>
          )}
        </div>
        <div className="rlm-field"><label className="rlm-label">ID number</label><input className="rlm-input" value={form.idNumber} onChange={e => set("idNumber", e.target.value)} placeholder="Optional" /></div>
        <div className="rlm-field" style={{ gridColumn: "1 / -1" }}><label className="rlm-label">Address</label><input className="rlm-input" value={form.address} onChange={e => set("address", e.target.value)} placeholder="Barangay, City" /></div>
        <div className="rlm-field"><label className="rlm-label">Contact number (optional)</label><input className="rlm-input" type="tel" value={form.contact} onChange={e => set("contact", e.target.value)} placeholder="09xx xxx xxxx" /></div>
        <div className="rlm-field"><label className="rlm-label">Monthly rent (total) *</label><input className="rlm-input" type="number" min="0" step="0.01" value={form.monthlyRent} onChange={e => set("monthlyRent", e.target.value)} placeholder="e.g. 4500" required />
          {form.monthlyRent !== "" && rentNum <=0 && <span style={{ fontSize:11, color:"var(--rust)" }}>Rent must be greater than 0</span>}
        </div>
        <div className="rlm-field"><label className="rlm-label">Move-in date *</label><input className="rlm-input" type="date" value={form.moveInDate} onChange={e => set("moveInDate", e.target.value)} required /></div>
        <div className="rlm-field">
          <label className="rlm-label">Payment schedule</label>
          <select className="rlm-select" value={paymentFrequency} onChange={e => set("paymentFrequency", e.target.value)}>
            <option value="monthly">Once a month</option>
            <option value="semimonthly">Twice a month (15th & 30th, no late interest)</option>
          </select>
        </div>
        {!semi && (
          <div className="rlm-field"><label className="rlm-label">Due day of month *</label><input className="rlm-input" type="number" min="1" max="31" value={form.dueDay} onChange={e => set("dueDay", e.target.value)} />
            {!dueDayValid && <span style={{ fontSize:11, color:"var(--rust)" }}>Must be 1–31</span>}
          </div>
        )}
      </div>
      {semi && (
        <p style={{ fontSize: 12, color: "#5b6663", marginTop: -6, marginBottom: 14 }}>
          The monthly rent above (plus any recurring charges) will be split into two equal installments, due on the 15th and the 30th of each month. No 1% late interest is applied to this tenant.
        </p>
      )}

      <div className="rlm-field" style={{ marginTop: 8 }}>
        <label className="rlm-label">Recurring monthly charges (optional)</label>
        <p style={{ fontSize: 12, color: "#5b6663", marginTop: -4, marginBottom: 10 }}>Fixed fees that apply every month, e.g. Wifi. For variable bills like electricity/water, add per-period in Payments.</p>
        {(form.additionalFees || []).map(fee => (
          <div key={fee.id} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <input className="rlm-input" placeholder="e.g. Wifi" value={fee.label} onChange={e => updateFeeRow(fee.id, "label", e.target.value)} />
            <input className="rlm-input" style={{ maxWidth: 130 }} type="number" min="0" step="0.01" placeholder="Amount" value={fee.amount} onChange={e => updateFeeRow(fee.id, "amount", e.target.value)} />
            <button type="button" className="rlm-btn rlm-btn-ghost" style={{ padding: 8 }} onClick={() => removeFeeRow(fee.id)} aria-label="Remove charge"><X size={14} /></button>
          </div>
        ))}
        <button type="button" className="rlm-btn rlm-btn-ghost" onClick={addFeeRow}><Plus size={14} /> Add recurring charge</button>
      </div>

      <div className="rlm-field" style={{ marginTop: 8 }}>
        <label className="rlm-label">Submeters / usage-based utilities (optional)</label>
        <p style={{ fontSize: 12, color: "#5b6663", marginTop: -4, marginBottom: 10 }}>
          For electricity, water, or anything billed by submeter. Set rate per unit here, then each period in Payments you enter previous/current — consumption & amount auto-calculated.
        </p>
        {(form.submeters || []).map(sm => (
          <div key={sm.id} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input className="rlm-input" style={{ flex: "1 1 160px" }} placeholder="e.g. Electricity" value={sm.label} onChange={e => updateSubmeterRow(sm.id, "label", e.target.value)} />
            <input className="rlm-input" style={{ maxWidth: 110 }} placeholder="Unit, e.g. kWh" value={sm.unit} onChange={e => updateSubmeterRow(sm.id, "unit", e.target.value)} />
            <input className="rlm-input" style={{ maxWidth: 130 }} type="number" min="0" step="0.01" placeholder="Rate/unit" value={sm.rate} onChange={e => updateSubmeterRow(sm.id, "rate", e.target.value)} />
            <button type="button" className="rlm-btn rlm-btn-ghost" style={{ padding: 8 }} onClick={() => removeSubmeterRow(sm.id)} aria-label="Remove submeter"><X size={14} /></button>
          </div>
        ))}
        <button type="button" className="rlm-btn rlm-btn-ghost" onClick={addSubmeterRow}><Plus size={14} /> Add submeter</button>
      </div>

      <div className="rlm-field" style={{ marginTop: 8 }}>
        <label className="rlm-label">Advance / deposit on move-in</label>
        <p style={{ fontSize: 12, color: "#5b6663", marginTop: -4, marginBottom: 10 }}>What the tenant paid upfront — separate from monthly rent, not in payment schedule.</p>
        <select className="rlm-select" style={{ maxWidth: 320, marginBottom: 10 }} value={depositType} onChange={e => set("depositType", e.target.value)}>
          {Object.entries(DEPOSIT_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        {(needsAdvance || needsDeposit) && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {needsAdvance && (
              <div className="rlm-field" style={{ marginBottom: 0, width: 180 }}>
                <label className="rlm-label">Advance amount</label>
                <input className="rlm-input" type="number" min="0" placeholder={form.monthlyRent || "0"} value={form.advanceAmount} onChange={e => set("advanceAmount", e.target.value)} />
              </div>
            )}
            {needsDeposit && (
              <div className="rlm-field" style={{ marginBottom: 0, width: 180 }}>
                <label className="rlm-label">Deposit amount</label>
                <input className="rlm-input" type="number" min="0" placeholder={form.monthlyRent || "0"} value={form.depositAmount} onChange={e => set("depositAmount", e.target.value)} />
              </div>
            )}
          </div>
        )}
        {depositType === "custom" && (
          <div className="rlm-field" style={{ marginBottom: 0, marginTop: 4 }}>
            <label className="rlm-label">Describe the arrangement</label>
            <input className="rlm-input" placeholder="e.g. Half month advance, no deposit" value={form.depositNotes} onChange={e => set("depositNotes", e.target.value)} />
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="rlm-btn rlm-btn-primary" disabled={!valid || (!semi && !dueDayValid)} style={{ opacity: valid && (semi || dueDayValid) ? 1 : 0.5 }} onClick={() => { if (valid && (semi || dueDayValid)) onSave({
          ...form,
          id: form.id || uid(),
          monthlyRent: Number(form.monthlyRent),
          dueDay: semi ? 1 : Number(form.dueDay),
          paymentFrequency,
          additionalFees: (form.additionalFees || []).filter(f => f.label.trim() && f.amount !== "").map(f => ({ id: f.id, label: f.label.trim(), amount: Number(f.amount) || 0 })),
          submeters: (form.submeters || []).filter(s => s.label.trim() && s.rate !== "").map(s => ({ id: s.id, label: s.label.trim(), unit: (s.unit || "").trim(), rate: Number(s.rate) || 0 })),
          depositType,
          advanceAmount: needsAdvance ? (Number(form.advanceAmount) || Number(form.monthlyRent) || 0) : 0,
          depositAmount: needsDeposit ? (Number(form.depositAmount) || Number(form.monthlyRent) || 0) : 0,
          depositNotes: depositType === "custom" ? (form.depositNotes || "") : "",
        }).catch(()=>{}) }}>Save tenant</button>
        <button className="rlm-btn rlm-btn-ghost" onClick={onCancel}><X size={14} /> Cancel</button>
      </div>
      {!valid && <p style={{ fontSize:12, color:"var(--rust)", marginTop:8 }}>Fill required fields (name, rent &gt;0, move-in date).</p>}
    </div>
  );
}

function TenantPicker({ tenants, selectedTenantId, setSelectedTenantId }) {
  return (
    <div className="rlm-field no-print" style={{ maxWidth: 320 }}>
      <label className="rlm-label">Tenant</label>
      <select className="rlm-select" value={selectedTenantId || ""} onChange={e => setSelectedTenantId(e.target.value)}>
        <option value="" disabled>Select a tenant</option>
        {tenants.map(t => <option key={t.id} value={t.id}>{t.name}{t.room ? ` — ${t.room}` : ""}</option>)}
      </select>
    </div>
  );
}

function PaymentsTab({ tenants, payments, settings, selectedTenant, selectedTenantId, setSelectedTenantId, payingKey, setPayingKey, paymentForm, setPaymentForm, chargesOpenKey, setChargesOpenKey, chargeInput, setChargeInput, addCharge, removeCharge, saveMeterReading, removeMeterReading, notesOpenKey, setNotesOpenKey, noteInput, setNoteInput, saveNote, markPaid, undoPaid, goInvoice, goReceipt }) {
  const periods = selectedTenant ? getPeriodsForTenant(selectedTenant) : [];
  const submeters = selectedTenant?.submeters || [];
  const [meterInputs, setMeterInputs] = useState({});
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    if (!chargesOpenKey || !selectedTenant) { setMeterInputs({}); return; }
    const tenantPayments = payments[selectedTenant.id] || {};
    const existing = tenantPayments[chargesOpenKey] || {};
    const savedReadings = existing.meterReadings || {};
    const inputs = {};
    submeters.forEach(sm => {
      const saved = savedReadings[sm.id];
      const defaultPrevious = getPreviousMeterReading(selectedTenant, payments, sm.id, chargesOpenKey);
      inputs[sm.id] = {
        previous: saved && saved.previous !== undefined ? String(saved.previous) : String(defaultPrevious),
        current: saved && saved.current !== undefined ? String(saved.current) : "",
      };
    });
    setMeterInputs(inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargesOpenKey, selectedTenant?.id]);

  const filteredPeriods = periods.filter(p=>{
    if(filter==="all") return true;
    const info=getPeriodInfo(selectedTenant, payments, p.year, p.month, p.half);
    return info.status===filter;
  });

  return (
    <div>
      <h1 className="rlm-h1">Payments</h1>
      <p className="rlm-sub">Track dues and mark rent as paid. Recurring charges apply automatically; enter submeter readings or add one-off charges per period. 1% late fee auto-applies when unpaid past due date.</p>

      {tenants.length === 0 ? (
        <div className="rlm-card"><p style={{ margin: 0 }}>Add a tenant first to start tracking payments.</p></div>
      ) : (
        <>
          <TenantPicker tenants={tenants} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} />
          {selectedTenant && (
            <>
              <div style={{ display:"flex", gap:8, margin:"8px 0 12px", flexWrap:"wrap" }} className="no-print">
                {[
                  {id:"all", label:"All"},
                  {id:"due", label:"Due"},
                  {id:"overdue", label:"Overdue"},
                  {id:"paid", label:"Paid"},
                ].map(f=> (
                  <button key={f.id} className={filter===f.id ? "rlm-btn rlm-btn-primary" : "rlm-btn rlm-btn-ghost"} style={{ padding:"6px 12px", fontSize:12 }} onClick={()=>setFilter(f.id)}>{f.label}</button>
                ))}
                <span style={{ fontSize:12, color:"#5b6663", alignSelf:"center", marginLeft:4 }}>{filteredPeriods.length} period(s)</span>
              </div>
              <div className="rlm-card" style={{ marginTop: 4 }}>
                <table className="rlm-table">
                  <thead><tr><th>Period</th><th>Due date</th><th>Rent + charges</th><th>Interest</th><th>Total</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {filteredPeriods.map(period => {
                      const info = getPeriodInfo(selectedTenant, payments, period.year, period.month, period.half);
                      const isPaying = payingKey === period.key;
                      const isEditingCharges = chargesOpenKey === period.key;
                      const isEditingNotes = notesOpenKey === period.key;
                      const extrasLines = [
                        ...info.recurringFees.map(f => `${f.label} ${formatMoney(f.amount, settings.currency)}`),
                        ...info.charges.map(c => `${c.label} ${formatMoney(c.amount, settings.currency)}`),
                      ];
                      return (
                        <Fragment key={period.key}>
                          <tr>
                            <td>
                              {periodDisplayLabel(period.year, period.month, period.half)}
                              <div>
                                <button className="rlm-btn rlm-btn-ghost" style={{ padding: "3px 8px", marginTop: 4, fontSize: 12 }}
                                  onClick={() => { setNotesOpenKey(isEditingNotes ? null : period.key); setNoteInput(info.notes || ""); }}>
                                  <FileText size={12} /> Notes
                                </button>
                              </div>
                              {info.notes && !isEditingNotes && (
                                <div style={{ fontSize: 11, color: "#5b6663", marginTop: 4, maxWidth: 170, whiteSpace: "pre-wrap", fontStyle: "italic" }}>{info.notes}</div>
                              )}
                            </td>
                            <td className="rlm-mono">{formatDate(toISODate(info.dueDate))}</td>
                            <td>
                              <div className="rlm-mono">{formatMoney(info.subtotal, settings.currency)}</div>
                              {extrasLines.length > 0 && <div className="rlm-extras-line">{extrasLines.join(" · ")}</div>}
                              {info.status !== "paid" && (
                                <button className="rlm-btn rlm-btn-ghost" style={{ padding: "3px 8px", marginTop: 4, fontSize: 12 }} onClick={() => setChargesOpenKey(isEditingCharges ? null : period.key)}>
                                  <Pencil size={12} /> Charges
                                </button>
                              )}
                            </td>
                            <td className="rlm-mono" style={{ color: info.interest > 0 ? "var(--rust)" : "inherit" }}>{info.interest > 0 ? formatMoney(info.interest, settings.currency) : "—"}</td>
                            <td className="rlm-mono" style={{ fontWeight: 600 }}>{formatMoney(info.total, settings.currency)}</td>
                            <td>
                              <span style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", color: info.status === "paid" ? "var(--green)" : info.status === "overdue" ? "var(--rust)" : "var(--brass)" }}>{info.status}</span>
                              {info.status === "paid" && <div style={{ fontSize: 11, color: "#5b6663" }}>on {formatDate(info.paidDate)}</div>}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {info.status === "paid" ? (
                                <div style={{ display: "flex", gap: 6, flexWrap:"wrap" }}>
                                  <button className="rlm-btn rlm-btn-ghost" style={{ padding: "6px 10px" }} onClick={() => goInvoice(period.key)}>Invoice</button>
                                  <button className="rlm-btn rlm-btn-brass" style={{ padding: "6px 10px" }} onClick={() => goReceipt(period.key)}>O.R.</button>
                                  <button className="rlm-btn rlm-btn-ghost" style={{ padding: 6 }} title="Undo payment" onClick={() => undoPaid(selectedTenant, period.key)}><Undo2 size={14} /></button>
                                </div>
                              ) : (
                                <button className="rlm-btn rlm-btn-brass" onClick={() => { setPayingKey(period.key); setPaymentForm({ amount: String(info.total.toFixed(2)), date: todayISO() }); }}>Mark paid</button>
                              )}
                            </td>
                          </tr>
                          {isEditingNotes && (
                            <tr>
                              <td colSpan={7} style={{ background: "#F4F1E7" }}>
                                <div style={{ fontSize: 12, color: "#5b6663", marginBottom: 8 }}>
                                  Notes for {periodDisplayLabel(period.year, period.month, period.half)}:
                                </div>
                                <textarea className="rlm-input" style={{ width: "100%", minHeight: 70, fontFamily: "inherit", resize: "vertical" }}
                                  value={noteInput} onChange={e => setNoteInput(e.target.value)}
                                  placeholder="e.g. Partial payment, arrangement, etc." />
                                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                                  <button className="rlm-btn rlm-btn-primary" onClick={() => saveNote(selectedTenant, period, noteInput)}>Save note</button>
                                  <button className="rlm-btn rlm-btn-ghost" onClick={() => setNotesOpenKey(null)}>Cancel</button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {isEditingCharges && (
                            <tr>
                              <td colSpan={7} style={{ background: "#F4F1E7" }}>
                                {submeters.length > 0 && (
                                  <div style={{ marginBottom: 16 }}>
                                    <div style={{ fontSize: 12, color: "#5b6663", marginBottom: 8 }}>
                                      Submeter readings as of {formatDate(toISODate(info.dueDate))}:
                                    </div>
                                    {submeters.map(sm => {
                                      const mi = meterInputs[sm.id] || { previous: "0", current: "" };
                                      const hasCurrent = mi.current !== "" && mi.current !== undefined;
                                      const { consumption, amount } = computeMeterAmount(mi.previous, mi.current, sm.rate);
                                      const savedForThisMeter = ((payments[selectedTenant.id] || {})[period.key] || {}).meterReadings?.[sm.id];
                                      return (
                                        <div key={sm.id} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10, paddingBottom: 10, borderBottom: "1px dashed var(--line)" }}>
                                          <div style={{ minWidth: 100, fontSize: 13, fontWeight: 600, paddingBottom: 9 }}>{sm.label}</div>
                                          <div className="rlm-field" style={{ marginBottom: 0, width: 120 }}>
                                            <label className="rlm-label">Previous</label>
                                            <input className="rlm-input" type="number" min="0" step="0.01" value={mi.previous}
                                              onChange={e => setMeterInputs(inp => ({ ...inp, [sm.id]: { ...inp[sm.id], previous: e.target.value } }))} />
                                          </div>
                                          <div className="rlm-field" style={{ marginBottom: 0, width: 120 }}>
                                            <label className="rlm-label">Current</label>
                                            <input className="rlm-input" type="number" min="0" step="0.01" value={mi.current}
                                              onChange={e => setMeterInputs(inp => ({ ...inp, [sm.id]: { ...inp[sm.id], current: e.target.value } }))} />
                                          </div>
                                          <div style={{ fontSize: 12, color: "#5b6663", paddingBottom: 9, minWidth: 150 }}>
                                            {hasCurrent ? `${consumption}${sm.unit ? " " + sm.unit : ""} × ${formatMoney(sm.rate, settings.currency)} = ` : "Rate "}
                                            <span className="rlm-mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{hasCurrent ? formatMoney(amount, settings.currency) : formatMoney(sm.rate, settings.currency) + `/${sm.unit || "unit"}`}</span>
                                          </div>
                                          <button className="rlm-btn rlm-btn-primary" style={{ padding: "6px 10px" }} disabled={!hasCurrent}
                                            onClick={() => saveMeterReading(selectedTenant, period, sm, mi.previous, mi.current)}>Save reading</button>
                                          {savedForThisMeter && (
                                            <button className="rlm-btn rlm-btn-ghost" style={{ padding: "6px 10px" }} onClick={() => removeMeterReading(selectedTenant, period, sm.id)}>Clear</button>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                <div style={{ fontSize: 12, color: "#5b6663", marginBottom: 8 }}>Other one-off charges for {periodDisplayLabel(period.year, period.month, period.half)}:</div>
                                {info.charges.filter(c => !String(c.id).startsWith("meter:")).length > 0 && (
                                  <div style={{ marginBottom: 10 }}>
                                    {info.charges.filter(c => !String(c.id).startsWith("meter:")).map(c => (
                                      <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, fontSize: 14 }}>
                                        <span style={{ minWidth: 140 }}>{c.label}</span>
                                        <span className="rlm-mono">{formatMoney(c.amount, settings.currency)}</span>
                                        <button className="rlm-btn rlm-btn-ghost" style={{ padding: 5 }} onClick={() => removeCharge(selectedTenant, period, c.id)}><Trash2 size={13} /></button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                                  <div className="rlm-field" style={{ marginBottom: 0, width: 180 }}><label className="rlm-label">Charge label</label><input className="rlm-input" placeholder="e.g. Repair fee" value={chargeInput.label} onChange={e => setChargeInput(f => ({ ...f, label: e.target.value }))} /></div>
                                  <div className="rlm-field" style={{ marginBottom: 0, width: 130 }}><label className="rlm-label">Amount</label><input className="rlm-input" type="number" min="0" step="0.01" value={chargeInput.amount} onChange={e => setChargeInput(f => ({ ...f, amount: e.target.value }))} /></div>
                                  <button className="rlm-btn rlm-btn-primary" onClick={() => addCharge(selectedTenant, period, chargeInput.label, chargeInput.amount)}><Plus size={14} /> Add charge</button>
                                  <button className="rlm-btn rlm-btn-ghost" onClick={() => setChargesOpenKey(null)}>Done</button>
                                </div>
                              </td>
                            </tr>
                          )}
                          {isPaying && (
                            <tr>
                              <td colSpan={7} style={{ background: "#F4F1E7" }}>
                                <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
                                  <div className="rlm-field" style={{ marginBottom: 0, width: 160 }}><label className="rlm-label">Amount paid</label><input className="rlm-input" type="number" min="0" step="0.01" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} /></div>
                                  <div className="rlm-field" style={{ marginBottom: 0, width: 170 }}><label className="rlm-label">Date paid</label><input className="rlm-input" type="date" value={paymentForm.date} onChange={e => setPaymentForm(f => ({ ...f, date: e.target.value }))} /></div>
                                  <button className="rlm-btn rlm-btn-primary" onClick={() => markPaid(selectedTenant, period)}>Save payment</button>
                                  <button className="rlm-btn rlm-btn-ghost" onClick={() => setPayingKey(null)}>Cancel</button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function InvoiceTab({ tenants, payments, settings, selectedTenant, selectedTenantId, setSelectedTenantId, invoicePeriodKey, setInvoicePeriodKey }) {
  const periods = selectedTenant ? getPeriodsForTenant(selectedTenant) : [];
  const activePeriod = periods.find(p => p.key === invoicePeriodKey) || periods[0];
  const info = selectedTenant && activePeriod ? getPeriodInfo(selectedTenant, payments, activePeriod.year, activePeriod.month, activePeriod.half) : null;
  const balance = info ? Math.max(info.total - info.amountPaid, 0) : 0;

  return (
    <div>
      <h1 className="rlm-h1 no-print">Invoice</h1>
      <p className="rlm-sub no-print">Generate a printable invoice for any period.</p>

      {tenants.length === 0 ? (
        <div className="rlm-card"><p style={{ margin: 0 }}>Add a tenant first to generate an invoice.</p></div>
      ) : (
        <>
          <div className="no-print" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
            <TenantPicker tenants={tenants} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} />
            {selectedTenant && (
              <div className="rlm-field" style={{ maxWidth: 240 }}>
                <label className="rlm-label">Period</label>
                <select className="rlm-select" value={activePeriod?.key || ""} onChange={e => setInvoicePeriodKey(e.target.value)}>
                  {periods.map(p => <option key={p.key} value={p.key}>{periodDisplayLabel(p.year, p.month, p.half)}</option>)}
                </select>
              </div>
            )}
          </div>

          {selectedTenant && info && (
            <>
              <div className="rlm-printable rlm-card" style={{ maxWidth: 640 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid var(--ink)", paddingBottom: 16, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700 }}>INVOICE</div>
                    <div className="rlm-mono" style={{ fontSize: 12, color: "#5b6663" }}>No. {String(selectedTenant.id||"").toUpperCase().slice(0, 6)}-{activePeriod.key}</div>
                    <div className="rlm-mono" style={{ fontSize: 11, color:"#5b6663" }}>{formatDate(todayISO())}</div>
                  </div>
                  <StatusStamp status={info.status} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20, fontSize: 14 }}>
                  <div>
                    <div className="rlm-label">From</div>
                    <div>{settings.landlordName || "—"}</div>
                    <div>{settings.landlordAddress || ""}</div>
                    <div>{settings.landlordContact || ""}</div>
                  </div>
                  <div>
                    <div className="rlm-label">Billed to</div>
                    <div>{selectedTenant.name}{selectedTenant.room ? ` (${selectedTenant.room})` : ""}</div>
                    <div>{selectedTenant.address}</div>
                    {selectedTenant.idNumber && <div className="rlm-mono" style={{ fontSize: 12 }}>ID: {selectedTenant.idNumber}</div>}
                    {selectedTenant.contact && <div style={{ fontSize:12 }}>{selectedTenant.contact}</div>}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 20, marginBottom: 20, fontSize: 14 }}>
                  <div><div className="rlm-label">Period</div>{periodDisplayLabel(activePeriod.year, activePeriod.month, activePeriod.half)}</div>
                  <div><div className="rlm-label">Due date</div>{formatDate(toISODate(info.dueDate))}</div>
                </div>

                <table className="rlm-table" style={{ marginBottom: 16 }}>
                  <thead><tr><th>Description</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
                  <tbody>
                    <tr><td>Monthly rent</td><td className="rlm-mono" style={{ textAlign: "right" }}>{formatMoney(info.base, settings.currency)}</td></tr>
                    {info.recurringFees.map(f => (
                      <tr key={f.id}><td>{f.label}</td><td className="rlm-mono" style={{ textAlign: "right" }}>{formatMoney(f.amount, settings.currency)}</td></tr>
                    ))}
                    {info.charges.map(c => (
                      <tr key={c.id}><td>{c.label}</td><td className="rlm-mono" style={{ textAlign: "right" }}>{formatMoney(c.amount, settings.currency)}</td></tr>
                    ))}
                    {info.interest > 0 && <tr><td>Late payment interest (1%)</td><td className="rlm-mono" style={{ textAlign: "right", color: "var(--rust)" }}>{formatMoney(info.interest, settings.currency)}</td></tr>}
                    <tr><td style={{ fontWeight: 600 }}>Total due</td><td className="rlm-mono" style={{ textAlign: "right", fontWeight: 600 }}>{formatMoney(info.total, settings.currency)}</td></tr>
                    <tr><td>Amount paid</td><td className="rlm-mono" style={{ textAlign: "right" }}>{formatMoney(info.amountPaid, settings.currency)}</td></tr>
                    <tr><td style={{ fontWeight: 600 }}>Balance</td><td className="rlm-mono" style={{ textAlign: "right", fontWeight: 600, color: balance > 0 ? "var(--rust)" : "var(--green)" }}>{formatMoney(balance, settings.currency)}</td></tr>
                  </tbody>
                </table>

                {info.notes && (
                  <div style={{ fontSize: 12, background: "#F4F1E7", border: "1px solid var(--line)", borderRadius: 4, padding: "8px 12px", marginBottom: 12, whiteSpace: "pre-wrap" }}>
                    <strong>Note:</strong> {info.notes}
                  </div>
                )}
                <p style={{ fontSize: 12, color: "#5b6663" }}>This invoice is system-generated and serves as an official record of the amount due for the period stated above.</p>
              </div>
              <button className="no-print rlm-btn rlm-btn-primary" style={{ marginTop: 16 }} onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function OfficialReceiptTab({ tenants, payments, settings, selectedTenant, selectedTenantId, setSelectedTenantId, receiptPeriodKey, setReceiptPeriodKey }) {
  const allPeriods = selectedTenant ? getPeriodsForTenant(selectedTenant) : [];
  const paidPeriods = allPeriods.filter(p => {
    const info = getPeriodInfo(selectedTenant, payments, p.year, p.month, p.half);
    return info.status === "paid";
  });
  const activePeriod = paidPeriods.find(p => p.key === receiptPeriodKey) || paidPeriods[0] || allPeriods[0];
  const info = selectedTenant && activePeriod ? getPeriodInfo(selectedTenant, payments, activePeriod.year, activePeriod.month, activePeriod.half) : null;
  const [orNo, setOrNo] = useState("");
  const [method, setMethod] = useState("Cash");
  useEffect(() => {
    if (selectedTenant && activePeriod) {
      const base = `OR-${activePeriod.key}-${String(selectedTenant.id||"").slice(0,4).toUpperCase()}`;
      setOrNo(base);
    }
  }, [selectedTenant?.id, activePeriod?.key]);
  if (tenants.length === 0) {
    return <div className="rlm-card"><p style={{ margin:0 }}>Add a tenant first to issue a receipt.</p></div>;
  }
  return (
    <div>
      <h1 className="rlm-h1 no-print">Official Receipt</h1>
      <p className="rlm-sub no-print">Issue a BIR-style Official Receipt for <strong>paid</strong> rent — distinct from Invoice (which is a bill). Only paid periods can be receipted.</p>
      <div className="no-print" style={{ display:"flex", gap:16, flexWrap:"wrap", marginBottom:20 }}>
        <TenantPicker tenants={tenants} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} />
        {selectedTenant && (
          <div className="rlm-field" style={{ maxWidth:260 }}>
            <label className="rlm-label">Paid period</label>
            <select className="rlm-select" value={activePeriod?.key || ""} onChange={e=>setReceiptPeriodKey(e.target.value)}>
              {paidPeriods.length === 0 ? <option value="">— No paid periods yet —</option> : paidPeriods.map(p => <option key={p.key} value={p.key}>{periodDisplayLabel(p.year, p.month, p.half)} — {formatMoney(getPeriodInfo(selectedTenant, payments, p.year, p.month, p.half).amountPaid, settings.currency)}</option>)}
            </select>
            {paidPeriods.length === 0 && <div style={{ fontSize:11, color:"var(--rust)", marginTop:4 }}>Mark a period as Paid in Payments first.</div>}
          </div>
        )}
      </div>
      {selectedTenant && info && (
        <>
          <div className="no-print rlm-card" style={{ maxWidth:480, display:"flex", gap:12, flexWrap:"wrap", marginBottom:12 }}>
            <div className="rlm-field" style={{ flex:"1 1 160px", marginBottom:0 }}><label className="rlm-label">OR No. (editable)</label><input className="rlm-input" value={orNo} onChange={e=>setOrNo(e.target.value)} placeholder="OR-2026-0001" /></div>
            <div className="rlm-field" style={{ flex:"1 1 140px", marginBottom:0 }}><label className="rlm-label">Payment method</label>
              <select className="rlm-select" value={method} onChange={e=>setMethod(e.target.value)}>
                <option>Cash</option><option>GCash</option><option>Bank Transfer</option><option>Check</option>
              </select>
            </div>
          </div>
          {info.status !== "paid" ? (
            <div className="rlm-card" style={{ maxWidth:640, borderColor:"var(--rust)" }}>
              <p style={{ margin:0, color:"var(--rust)" }}>This period is not yet paid — receipt can only be issued for <strong>Paid</strong> status. Current: <strong>{info.status}</strong>. Go to Payments → Mark paid.</p>
            </div>
          ) : (
            <div className="rlm-printable rlm-card" style={{ maxWidth:640, border:"2px solid var(--ink)" }}>
              <div style={{ textAlign:"center", borderBottom:"2px solid var(--ink)", paddingBottom:12, marginBottom:16 }}>
                <div style={{ fontFamily:"var(--font-display)", fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", color:"#5b6663" }}>BeDa Rooms</div>
                <div style={{ fontFamily:"var(--font-display)", fontSize:22, fontWeight:800, letterSpacing:"0.04em" }}>OFFICIAL RECEIPT</div>
                <div style={{ fontSize:11, color:"#5b6663" }}>{settings.landlordAddress || ""} {settings.landlordContact ? `• ${settings.landlordContact}` : ""}</div>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:12, flexWrap:"wrap", gap:8 }}>
                <div><span className="rlm-label">OR No.</span> <span className="rlm-mono" style={{ fontWeight:700 }}>{orNo || "—"}</span></div>
                <div><span className="rlm-label">Date</span> {formatDate(info.paidDate)}</div>
              </div>
              <div style={{ background:"#F4F1E7", border:"1px solid var(--line)", borderRadius:6, padding:"10px 14px", marginBottom:14, fontSize:14 }}>
                <div><span className="rlm-label">Received from</span> <strong>{selectedTenant.name}</strong>{selectedTenant.room ? ` — ${selectedTenant.room}` : ""}</div>
                {selectedTenant.address && <div style={{ fontSize:12, color:"#5b6663" }}>{selectedTenant.address}</div>}
                <div style={{ marginTop:6 }}><span className="rlm-label">Amount</span> <span className="rlm-mono" style={{ fontSize:18, fontWeight:700 }}>{formatMoney(info.amountPaid, settings.currency)}</span> <span style={{ fontSize:12, color:"#5b6663" }}>via {method}</span></div>
                <div style={{ fontSize:12, fontStyle:"italic", color:"#5b6663", borderTop:"1px dashed var(--line)", marginTop:8, paddingTop:6 }}>{pesoWords(info.amountPaid, settings.currency)}.</div>
              </div>
              <div style={{ fontSize:13, marginBottom:10 }}><span className="rlm-label">Payment for</span> {periodDisplayLabel(activePeriod.year, activePeriod.month, activePeriod.half)} — {info.recurringFees.map(f=>f.label).join(", ") ? `incl. ${info.recurringFees.map(f=>f.label).join(", ")}` : "Monthly rent"}{info.charges.length ? ` + ${info.charges.map(c=>c.label).join(", ")}` : ""}</div>
              <table className="rlm-table" style={{ marginBottom:14, fontSize:12 }}>
                <thead><tr><th>Description</th><th style={{ textAlign:"right" }}>Amount</th></tr></thead>
                <tbody>
                  <tr><td>Rent ({periodDisplayLabel(activePeriod.year, activePeriod.month, activePeriod.half)})</td><td className="rlm-mono" style={{ textAlign:"right" }}>{formatMoney(info.base, settings.currency)}</td></tr>
                  {info.recurringFees.map(f=> <tr key={f.id}><td>{f.label}</td><td className="rlm-mono" style={{ textAlign:"right" }}>{formatMoney(f.amount, settings.currency)}</td></tr>)}
                  {info.charges.map(c=> <tr key={c.id}><td>{c.label}</td><td className="rlm-mono" style={{ textAlign:"right" }}>{formatMoney(c.amount, settings.currency)}</td></tr>)}
                  {info.interest > 0 && <tr><td>Late interest 1%</td><td className="rlm-mono" style={{ textAlign:"right" }}>{formatMoney(info.interest, settings.currency)}</td></tr>}
                  <tr style={{ fontWeight:700, background:"#F4F1E7" }}><td>Total paid</td><td className="rlm-mono" style={{ textAlign:"right" }}>{formatMoney(info.amountPaid, settings.currency)}</td></tr>
                </tbody>
              </table>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginTop:24, fontSize:12 }}>
                <div style={{ borderTop:"1px solid var(--ink)", paddingTop:6, textAlign:"center" }}>{settings.landlordName || "Authorized Signature"}<div style={{ fontSize:10, color:"#5b6663" }}>Collector / Landlord</div></div>
                <div style={{ borderTop:"1px solid var(--ink)", paddingTop:6, textAlign:"center" }}>{selectedTenant.name}<div style={{ fontSize:10, color:"#5b6663" }}>Payor</div></div>
              </div>
              <div style={{ fontSize:10, color:"#5b6663", textAlign:"center", marginTop:16, borderTop:"1px dashed var(--line)", paddingTop:8 }}>
                This Official Receipt acknowledges payment received — keep for records. Invoice is a bill (amount due); Receipt is proof of payment.
              </div>
            </div>
          )}
          <div className="no-print" style={{ display:"flex", gap:10, marginTop:16, flexWrap:"wrap" }}>
            <button className="rlm-btn rlm-btn-primary" disabled={info.status !== "paid"} onClick={()=>window.print()}><Printer size={15}/> Print / Save as PDF</button>
            {info.status !== "paid" && <span style={{ fontSize:12, color:"var(--rust)", alignSelf:"center" }}>Print disabled — mark as paid first.</span>}
          </div>
        </>
      )}
    </div>
  );
}

function ContractTab({ tenants, settings, selectedTenant, selectedTenantId, setSelectedTenantId }) {
  return (
    <div>
      <h1 className="rlm-h1 no-print">Contract</h1>
      <p className="rlm-sub no-print">A printable rental agreement, auto-filled with each tenant's details.</p>

      {tenants.length === 0 ? (
        <div className="rlm-card"><p style={{ margin: 0 }}>Add a tenant first to generate a contract.</p></div>
      ) : (
        <>
          <div className="no-print"><TenantPicker tenants={tenants} selectedTenantId={selectedTenantId} setSelectedTenantId={setSelectedTenantId} /></div>

          {selectedTenant && (
            <>
              <div className="rlm-printable rlm-card" style={{ maxWidth: 700, lineHeight: 1.7, fontSize: 14 }}>
                <div style={{ textAlign: "center", fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, marginBottom: 4 }}>ROOM RENTAL AGREEMENT</div>
                <div style={{ textAlign: "center", fontSize: 12, color: "#5b6663", marginBottom: 24 }}>Prepared on {formatDate(todayISO())}</div>

                <p>This Room Rental Agreement ("Agreement") is entered into between:</p>
                <p><strong>Landlord:</strong> {settings.landlordName || "_______________________"}, of {settings.landlordAddress || "_______________________"} ("Landlord"), and</p>
                <p><strong>Tenant:</strong> {selectedTenant.name}, holder of ID number {selectedTenant.idNumber || "_______________________"}, residing at {selectedTenant.address || "_______________________"} ("Tenant").</p>

                <p><strong>1. Term.</strong> This Agreement covers {selectedTenant.room || "the room assigned to the Tenant"} and takes effect on {formatDate(selectedTenant.moveInDate)}, continuing on a month-to-month basis until terminated by either party in accordance with applicable notice requirements.</p>
                <p><strong>2. Rent.</strong> {isSemiMonthly(selectedTenant) ? (
                  <>The Tenant agrees to pay the Landlord a total monthly rent of {formatMoney(selectedTenant.monthlyRent, settings.currency)}, payable in two (2) equal installments of {formatMoney((Number(selectedTenant.monthlyRent) || 0) / 2, settings.currency)} each, due on or before the 15th and the 30th day of each calendar month.</>
                ) : (
                  <>The Tenant agrees to pay the Landlord a monthly rent of {formatMoney(selectedTenant.monthlyRent, settings.currency)}, due on or before the {ordinal(selectedTenant.dueDay)} day of each calendar month.</>
                )}</p>
                {(() => {
                  const depositType = selectedTenant.depositType || "none";
                  let depositClause = null;
                  if (depositType === "advance") depositClause = <>Upon signing, the Tenant shall pay the Landlord an advance payment of {formatMoney(selectedTenant.advanceAmount, settings.currency)}, equivalent to one (1) month's rent. This advance is non-refundable, but shall instead be credited against rent for the Tenant's final days of occupancy upon move-out, computed proportionately against the remaining days covered. No separate security deposit is required.</>;
                  else if (depositType === "deposit") depositClause = <>Upon signing, the Tenant shall pay the Landlord a security deposit of {formatMoney(selectedTenant.depositAmount, settings.currency)}, equivalent to one (1) month's rent. This deposit is non-refundable in cash, but shall instead be credited against rent for the Tenant's final days of occupancy upon move-out, computed proportionately against the remaining days covered, less any deductions for unpaid charges or damage to the premises beyond normal wear and tear. No advance rent payment is required.</>;
                  else if (depositType === "both") depositClause = <>Upon signing, the Tenant shall pay the Landlord an advance payment of {formatMoney(selectedTenant.advanceAmount, settings.currency)} and a security deposit of {formatMoney(selectedTenant.depositAmount, settings.currency)}, each equivalent to one (1) month's rent. Both the advance and the deposit are non-refundable in cash; instead, they shall be credited against rent for the Tenant's final days of occupancy upon move-out, computed proportionately against the remaining days covered, less any deductions for unpaid charges or damage to the premises beyond normal wear and tear.</>;
                  else if (depositType === "custom") depositClause = <>Upon signing, the following advance/deposit arrangement applies: {selectedTenant.depositNotes || "as agreed by both parties"}.</>;
                  if (!depositClause) return null;
                  return <p><strong>3. Advance / Security Deposit.</strong> {depositClause}</p>;
                })()}
                {(selectedTenant.additionalFees || []).length > 0 && (
                  <p><strong>{(selectedTenant.depositType && selectedTenant.depositType !== "none") ? "4" : "3"}. Additional Charges.</strong> In addition to rent, the Tenant agrees to pay the following recurring monthly charges: {selectedTenant.additionalFees.map(f => `${f.label} (${formatMoney(f.amount, settings.currency)})`).join(", ")}. Charges for utilities that vary by usage, such as electricity or water, will be billed separately each month based on actual consumption.</p>
                )}
                {(() => {
                  const hasDeposit = selectedTenant.depositType && selectedTenant.depositType !== "none";
                  const hasFees = (selectedTenant.additionalFees || []).length > 0;
                  const n = 3 + (hasDeposit ? 1 : 0) + (hasFees ? 1 : 0);
                  return (
                    <>
                      <p><strong>{n}. Late Payment.</strong> {isSemiMonthly(selectedTenant) ? (
                        <>As the Tenant follows the twice-a-month installment schedule stated above, no late payment interest shall apply to this Agreement, provided each installment is settled on or before its respective due date.</>
                      ) : (
                        <>If the total amount due is not paid in full by the due date stated above, a late payment interest of one percent (1%) of that month's total amount due shall be added.</>
                      )}</p>
                      <p><strong>{n + 1}. Use of Premises.</strong> The room shall be used solely as a residence for the Tenant and shall not be sublet without the Landlord's prior written consent.</p>
                      <p><strong>{n + 2}. Termination.</strong> Either party may terminate this Agreement by providing written notice at least thirty (30) days in advance.</p>
                    </>
                  );
                })()}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, marginTop: 48 }}>
                  <div>
                    <div style={{ borderTop: "1px solid var(--ink)", paddingTop: 6 }}>Landlord's Signature</div>
                    <div style={{ fontSize: 12, color: "#5b6663", marginTop: 4 }}>{settings.landlordName || ""}</div>
                  </div>
                  <div>
                    <div style={{ borderTop: "1px solid var(--ink)", paddingTop: 6 }}>Tenant's Signature</div>
                    <div style={{ fontSize: 12, color: "#5b6663", marginTop: 4 }}>{selectedTenant.name}</div>
                  </div>
                </div>
              </div>
              <button className="no-print rlm-btn rlm-btn-primary" style={{ marginTop: 16 }} onClick={() => window.print()}><Printer size={15} /> Print / Save as PDF</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SettingsTab({ settings, saveSettings, onReset, tenants, payments, onRestore }) {
  const [form, setForm] = useState(settings);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const fileRef = useRef(null);

  useEffect(()=> setForm(settings), [settings]);

  function downloadBackupJSON() {
    const payload = { exportedAt: new Date().toISOString(), version: APP_VERSION, tenants, payments, settings };
    downloadFile(`rental-manager-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2), "application/json");
  }

  function downloadTenantsCSV() {
    const header = ["Name", "Room", "ID number", "Address", "Contact", "Monthly rent", "Payment frequency", "Due day", "Move-in date", "Deposit type", "Advance amount", "Deposit amount"];
    const rows = tenants.map(t => [
      t.name, t.room, t.idNumber, t.address, t.contact, t.monthlyRent,
      isSemiMonthly(t) ? "Twice a month (15th & 30th)" : "Once a month", t.dueDay, t.moveInDate,
      t.depositType, t.advanceAmount, t.depositAmount,
    ]);
    downloadFile(`tenants-${todayISO()}.csv`, toCSV([header, ...rows]), "text/csv;charset=utf-8;");
  }

  return (
    <div>
      <h1 className="rlm-h1">Settings</h1>
      <p className="rlm-sub">Your details appear on every invoice and contract. Works fully offline — install as PWA for best experience.</p>

      <div className="rlm-card" style={{ maxWidth: 480, marginBottom: 20 }}>
        <div className="rlm-field"><label className="rlm-label">Landlord / business name</label><input className="rlm-input" value={form.landlordName} onChange={e => set("landlordName", e.target.value)} placeholder="e.g. BeDa Rooms" /></div>
        <div className="rlm-field"><label className="rlm-label">Address</label><input className="rlm-input" value={form.landlordAddress} onChange={e => set("landlordAddress", e.target.value)} placeholder="Street, Barangay, City" /></div>
        <div className="rlm-field"><label className="rlm-label">Contact number</label><input className="rlm-input" type="tel" value={form.landlordContact} onChange={e => set("landlordContact", e.target.value)} placeholder="09xx xxx xxxx" /></div>
        <div className="rlm-field"><label className="rlm-label">Currency symbol</label><input className="rlm-input" style={{ width: 80 }} value={form.currency} onChange={e => set("currency", e.target.value)} /></div>
        <button className="rlm-btn rlm-btn-primary" onClick={() => saveSettings(form)}>Save settings</button>
      </div>

      <div className="rlm-card" style={{ maxWidth: 480, marginBottom: 20 }}>
        <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>Backup & restore</h3>
        <p style={{ fontSize: 13, color: "#5b6663" }}>
          Everything is stored in this browser only. Download a backup regularly — especially before clearing browser data or switching devices. You can also restore a previous backup below (merges / replaces current data).
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <button className="rlm-btn rlm-btn-ghost" onClick={downloadTenantsCSV} disabled={tenants.length === 0}><Download size={14} /> Tenants (CSV)</button>
          <button className="rlm-btn rlm-btn-ghost" onClick={downloadBackupJSON}><Download size={14} /> Full backup (JSON)</button>
        </div>
        <div style={{ borderTop:"1px solid var(--line)", paddingTop:12, marginTop:4 }}>
          <label className="rlm-label">Restore from backup (JSON)</label>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ fontSize:12 }} onChange={async e=>{
              const f=e.target.files?.[0];
              if(f) { await onRestore(f); e.target.value=""; }
            }} />
            <span style={{ fontSize:11, color:"#5b6663" }}>Will replace tenants/payments/settings after confirmation.</span>
          </div>
          <p style={{ fontSize:11, color:"var(--rust)", marginTop:6 }}>Warning: restoring will overwrite current data. Export a backup first if needed.</p>
        </div>
      </div>

      <div className="rlm-card" style={{ maxWidth: 480, marginBottom:20 }}>
        <h3 style={{ marginTop:0, fontFamily:"var(--font-display)" }}>PWA & Offline</h3>
        <p style={{ fontSize:13, color:"#5b6663" }}>
          This app is installable and works offline. Once installed (Add to Home Screen / Install app), you can open it without internet, and data stays on your device.
        </p>
        <ul style={{ fontSize:12, color:"#5b6663", lineHeight:1.6 }}>
          <li>Offline-ready via Service Worker (precaches UI & fonts)</li>
          <li>Install prompt appears automatically when eligible</li>
          <li>Updates check hourly; you'll see a banner when a new version is ready</li>
          <li>Data is never sent to a server — only localStorage on this device</li>
        </ul>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button className="rlm-btn rlm-btn-ghost" onClick={()=> window.location.reload()}><RefreshCw size={14}/> Reload</button>
          <button className="rlm-btn rlm-btn-ghost" onClick={async()=>{ try{ await window.storage.clearAllCache(); alert('Cache cleared — reloading clean.'); location.reload(); } catch(e){ alert('Clear failed: '+e.message); }}}><Trash2 size={14}/> Clear Cache (this window)</button>
          <button className="rlm-btn rlm-btn-primary" onClick={async()=>{ try{ await window.storage.clearCacheAndOpenNewWindow(); } catch(e){ alert('Clear failed: '+e.message); }}}><RefreshCw size={14}/> Clear Cache & Open New Clean Window</button>
          <button className="rlm-btn rlm-btn-ghost" onClick={()=> { if('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).then(()=>alert('Service workers unregistered — reload to re-install.')); }}><LogOut size={14}/> Unregister SW (debug)</button>
        </div>
        <p style={{ fontSize:11, color:"#5b6663", marginTop:8 }}>Clear Cache removes <code>rlm:*</code>, <code>sb-*</code>, CacheStorage & Service Workers, then opens <code>{location.origin}</code> in a new tab with <code>?clear</code> — use if new window still shows stale data.</p>
      </div>

      <div className="rlm-card" style={{ maxWidth: 480, borderColor: "var(--rust)" }}>
        <h3 style={{ marginTop: 0, fontFamily: "var(--font-display)" }}>Danger zone</h3>
        <p style={{ fontSize: 13, color: "#5b6663" }}>Permanently delete all tenants, payments, and settings. Consider exporting a backup first.</p>
        {confirmingReset ? (
          <div style={{ display: "flex", gap: 10 }}>
            <button className="rlm-btn rlm-btn-danger" onClick={() => { onReset(); setConfirmingReset(false); }}>Yes, delete everything</button>
            <button className="rlm-btn rlm-btn-ghost" onClick={() => setConfirmingReset(false)}>Cancel</button>
          </div>
        ) : (
          <button className="rlm-btn rlm-btn-danger" onClick={() => setConfirmingReset(true)}><Trash2 size={14} /> Reset all data</button>
        )}
      </div>
    </div>
  );
}
