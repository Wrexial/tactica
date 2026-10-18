import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves project sites from /<repo>/, while Netlify and the
  // local preview server use the domain root. `VITE_BASE` lets the deploy
  // workflow set the prefix without changing the default `/`. See T106.
  base: process.env.VITE_BASE ?? "/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
