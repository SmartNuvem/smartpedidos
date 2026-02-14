import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:3000";

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["pwa-192.svg", "pwa-512.svg"],
        manifest: {
          name: "SmartPedido Garçom",
          short_name: "Garçom",
          start_url: "/s",
          display: "standalone",
          background_color: "#0f172a",
          theme_color: "#0f172a",
          icons: [
            {
              src: "/pwa-192.svg",
              sizes: "192x192",
              type: "image/svg+xml",
            },
            {
              src: "/pwa-512.svg",
              sizes: "512x512",
              type: "image/svg+xml",
            },
          ],
        },
      }),
    ],
    server: {
      host: true,
      port: 5173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
