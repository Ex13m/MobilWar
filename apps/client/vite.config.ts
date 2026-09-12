import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "node:path";

// HTTPS is required on phones for camera / GPS / compass. In dev we self-sign.
export default defineConfig(({ command, isPreview }) => ({
  plugins: command === "serve" && !isPreview ? [basicSsl()] : [],
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
