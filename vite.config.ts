import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const frontendRoot = resolve(process.cwd(), "src/frontend");

export default defineConfig({
  base: "./",
  plugins: [react()],
  root: frontendRoot,
  publicDir: "static",
  build: {
    outDir: resolve(process.cwd(), "extension-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        viewer: resolve(frontendRoot, "viewer.html"),
        sidepanel: resolve(frontendRoot, "sidepanel.html"),
        sandbox: resolve(frontendRoot, "sandbox.html"),
      },
    },
  },
});
