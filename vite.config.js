import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist/unpacked",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        newtab: resolve(__dirname, "newtab.html"),
        popup: resolve(__dirname, "popup.html"),
        background: resolve(__dirname, "src/background.js")
      },
      output: {
        entryFileNames: (chunkInfo) => (chunkInfo.name === "background" ? "src/background.js" : "assets/[name]-[hash].js"),
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
