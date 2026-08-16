import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

const SITE = process.env.PUBLIC_SITE_URL || "https://citerate.com";

export default defineConfig({
  site: SITE,

  // Marketing pages are static; only the routes that need a request are server-rendered.
  // Each of those opts in with `export const prerender = false`.
  output: "static",

  adapter: cloudflare({
    platformProxy: { enabled: true }, // gives `locals.runtime.env` (D1/KV/R2) in `astro dev`
    imageService: "compile"
  }),

  integrations: [
    mdx(),
    sitemap({
      filter: (page) =>
        !page.includes("/scan/") && // teaser results are never indexed
        !page.includes("/api/")
    })
  ],

  build: {
    inlineStylesheets: "auto",
    assets: "_astro"
  },

  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          // silence Bootstrap 5.3's deprecation noise, keep our own warnings
          silenceDeprecations: ["import", "global-builtin", "color-functions", "mixed-decls"]
        }
      }
    },
    build: { cssMinify: "lightningcss" }
  },

  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },

  devToolbar: { enabled: false }
});
