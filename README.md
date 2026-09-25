# BeDa Rooms — Rental Manager (PWA)

A tenant and rent tracking **PWA** — tenant records, monthly dues with automatic **1% late interest**, **submeter** utilities (electric/water), printable invoices & rental contracts. **Installable, offline-ready.**

![PWA](https://img.shields.io/badge/PWA-offline--ready-1B2A28) ![Vite](https://img.shields.io/badge/Vite-5.4-646cff) ![React](https://img.shields.io/badge/React-18-61dafb)

## ✨ What changed vs. original

**PWA (installable offline):**
- `vite-plugin-pwa` with **generateSW (Workbox)** — precaches UI, fonts cached with `CacheFirst`, `navigateFallback: index.html`
- `manifest.webmanifest` (standalone, theme `#1B2A28`, 192/512 + maskable icons, shortcuts → Dashboard/Tenants/Payments)
- Icons: `public/icons/icon-{192,512}.png`, `icon-*-maskable.png`, `apple-touch-icon.png`, `favicon.ico` (+ `index.html` meta: `theme-color`, `apple-mobile-web-app-capable`)
- In-app **Install prompt** (`beforeinstallprompt`), **Update available** banner (hourly `registration.update()`), **Offline indicator** & `offlineReady` toast
- Works on `file://`? No — serve `dist/` over HTTPS (required for Service Worker). Local `vite preview` simulates it.

**Fixes & enhancements (best-practice):**
- **Responsive**: mobile top bar + slide-in drawer, `100dvh`, tables horizontally scroll, `grid` collapses at 760/480px
- **Persistence**: tab persisted to `localStorage` + URL hash (`#dashboard`), hashchange listener, no more lost tab on reload
- **Search/filter**: Dashboard (tenants + history) & Tenants & Payments (status filter) — live `useState` filter
- **Validation**: rent must be >0, `dueDay` 1–31 range, required name/move-in, rate-unit checks
- **Import/restore**: `Settings → Restore from backup (JSON)` — validates `{tenants,payments,settings}`, supports wrapped `value` payloads
- **Toasts & UX**: global toast (`Tenant added / Payment saved / etc.`), `Save settings` feedback, storage-full friendly message (quota detection in `storage.js`)
- **Storage hardened**: `storage.js` now try/catch + `QuotaExceededError` detection, `__rlm_storageSize()` helper, graceful null on failure
- **CSS extracted**: inline `<style>` moved to `src/index.css` (proper HMR, caching, separation)
- **Accessibility**: `nav` with `aria-label`, `aria-current="page"`, `role="status/alert"`, `aria-required`, keyboard `focus-visible`, button `type="button"` where needed, `noscript` fallback
- **ErrorBoundary** in `main.jsx`, loading spinner via CSS `@keyframes`
- **Performance**: Workbox runtime cache for Google Fonts, hour-interval update check, `cleanupOutdatedCaches`
- **Docs**: updated `index.html` description, `package.json` description + version `1.1.0`, `preview` script, `APP_VERSION` footer

## Project structure
```
room-rental-manager/
├── public/
│   ├── favicon.ico / favicon-32.png
│   └── icons/icon-*.png (192,512,maskable,apple)
├── index.html          → PWA meta + manifest link
├── vite.config.js      → react() + VitePWA({...})
├── package.json
└── src/
    ├── main.jsx        → ErrorBoundary, index.css
    ├── index.css       → all app styles + @media + print
    ├── App.jsx         → app + hooks (useOnline,usePWA,useSWUpdate), toasts, responsive, search, import
    └── storage.js      → localStorage wrapper with quota handling
```

## Run locally
Requires Node 18+.

```bash
npm install
npm run dev      # http://localhost:5173 — PWA disabled in dev (devOptions.enabled:false)
npm run build    # → dist/ (precached)
npm run preview  # http://localhost:4173 — test PWA (HTTPS needed for full install in prod)
```

> Your tenants & payments stay in **this browser's `localStorage`** (key `rlm:user:rental-data`) — per-device. Clearing browser data erases them → use **Settings → Full backup (JSON)** regularly. `localStorage ≈5MB`; app warns on quota.

## Deploy (static host)
`npm run build` outputs `dist/` — deploy that folder anywhere:

- **Netlify** — drag `dist` to dashboard (SPA: no redirect needed — `navigateFallback` handles reloads, but you may add `public/_redirects` with `/* /index.html 200` if you add client routing).
- **Vercel** — `vercel --prod` (set output to `dist`) or `vercel.json` `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
- **GitHub Pages** — push `dist`, enable Pages; ensure `scope`/`start_url` match repo base (if `/repo/`, set `base` in `vite.config.js`).
- **Cloudflare Pages** — `Build: npm run build`, `Output: dist`

Must be **HTTPS** for installability.

## PWA checklist (how to verify)
1. `npm run preview` → Chrome DevTools → **Application → Manifest** — should show name/icons/shortcuts.
2. **Service Workers** — `sw.js` active, `workbox` listed.
3. **Lighthouse**: `npm run audit:pwa` or Chrome → Lighthouse → PWA (≥90).
4. Install: address bar **Install** icon / `beforeinstallprompt` banner in app / `chrome://apps`.
5. Offline: DevTools → Network → Offline → reload — app shell & data still load; add tenant offline → re-online still there.

## Data & backups
- **Tenants (CSV)** — `Settings → Tenants (CSV)` + Dashboard `Download history (CSV)`
- **Full backup (JSON)** — `{ exportedAt, version, tenants, payments, settings }` — re-import via **Settings → Restore** (overwrites current).
- Inspect size: DevTools Console → `__rlm_storageSize()` (bytes).

## Future wiring (optional)
- Move `localStorage` → IndexedDB (larger) or Supabase (shared multi-device) — ask and I can wire it.
- Add auth + row-level security if you need multi-landlord.

## Tech
React 18, Vite 5, `vite-plugin-pwa` 1.3 + Workbox 7, `lucide-react`, Google Fonts (Fraunces / IBM Plex).

# beda-rooms
