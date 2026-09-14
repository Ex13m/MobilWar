import { defineConfig, type Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

/** Identifies this build. The client compares it against /version.json on launch. */
const BUILD_ID = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

/**
 * Emits version.json and stamps the service worker's cache name with the build
 * id, so a deploy actually reaches phones that already have the PWA installed
 * instead of serving them last week's bundle out of the cache.
 */
function buildStamp(): Plugin {
  let outDir = "dist";
  return {
    name: "mobilwar-build-stamp",
    configResolved(cfg) {
      outDir = resolve(cfg.root, cfg.build.outDir);
    },
    // public/ is copied outside the rollup bundle, so the worker is stamped on
    // disk once the copy has happened.
    async writeBundle() {
      await writeFile(join(outDir, "version.json"), JSON.stringify({ build: BUILD_ID }));
      const swPath = join(outDir, "sw.js");
      try {
        const sw = await readFile(swPath, "utf8");
        await writeFile(swPath, sw.replaceAll("__BUILD_ID__", BUILD_ID));
      } catch {
        /* no worker in this build */
      }
    },
  };
}

// HTTPS is required on phones for camera / GPS / compass. In dev we self-sign.
export default defineConfig(({ command, isPreview }) => ({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: command === "serve" && !isPreview ? [basicSsl()] : [buildStamp()],
  resolve: { alias: { "@mobilwar/shared": resolve(import.meta.dirname, "../../packages/shared/src/index.ts") } },
  server: { port: 5173, host: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        referee: resolve(import.meta.dirname, "referee.html"),
      },
    },
  },
  test: { include: ["test/**/*.test.ts"] },
}));
