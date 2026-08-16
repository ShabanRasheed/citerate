import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// The dashboard is authenticated on every route: server output, no prerender.
// (The marketing repo is the opposite — static except a handful of endpoints.)
export default defineConfig({
  site: process.env.PUBLIC_APP_URL || "https://app.citerate.com",
  output: "server",
  adapter: cloudflare({
    // persist points at the SIBLING repo's local state so both repos read the
    // same local D1/KV/R2 — locally what one database in production means.
    platformProxy: { enabled: true, persist: { path: "../citerate/.wrangler/state/v3" } },
    imageService: "passthrough"
  }),
  prefetch: { prefetchAll: true, defaultStrategy: "hover" },
  vite: {
    ssr: { external: ["node:crypto"] },
    build: {
      // Bootstrap JS + Alpine + ECharts are the only vendor chunks; ECharts is
      // split so pages without a chart never download it.
      rollupOptions: {
        output: {
          manualChunks: {
            echarts: ["echarts"],
            bootstrap: ["bootstrap"],
            alpine: ["alpinejs"]
          }
        }
      }
    }
  }
});
