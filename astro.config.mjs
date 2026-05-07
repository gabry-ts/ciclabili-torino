import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://ciclabili.local",
  server: {
    port: 4321,
    host: true,
  },
  vite: {
    server: {
      hmr: { overlay: true },
    },
  },
  build: {
    inlineStylesheets: "auto",
  },
});
