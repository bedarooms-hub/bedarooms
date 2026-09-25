import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.ico", "favicon-32.png", "icons/*.png"],
      manifest: {
        name: "BeDa Rooms — Rental Manager",
        short_name: "BeDa Rooms",
        description: "Tenant and rent tracking — monthly dues, 1% late interest, invoices and contracts. Works offline.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        display_override: ["standalone", "window-controls-overlay"],
        orientation: "any",
        theme_color: "#1B2A28",
        background_color: "#EFEDE3",
        categories: ["business", "finance", "productivity"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        screenshots: [
          { src: "icons/icon-512.png", sizes: "512x512", form_factor: "wide", label: "BeDa Rooms dashboard" },
        ],
        shortcuts: [
          { name: "Dashboard", url: "/#dashboard", description: "View rent overview" },
          { name: "Add Tenant", url: "/#tenants", description: "Add a new tenant" },
          { name: "Payments", url: "/#payments", description: "Track payments" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "gfonts-cache", expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
