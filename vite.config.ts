import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: false,
  build: {
    outDir: "public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/agents": {
        target: "http://localhost:8787",
        changeOrigin: true,
        ws: true,
      },
      "/view": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
