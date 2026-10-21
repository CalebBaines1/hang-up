import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev the API runs on :8787; proxy it (including the call WebSocket) so the
// app and API share an origin. In production set VITE_API_URL to the API's URL.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/api": { target: "http://localhost:8787", ws: true, changeOrigin: true },
    },
  },
});
