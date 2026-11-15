import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { localDirectionsPlugin } from "./server/maps/viteDirections";
import { fallbackLivePlugin } from "./server/fallback/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "./",
    plugins: [
      react(),
      localDirectionsPlugin(env.KAKAO_DIRECTIONS_REST_API_KEY),
      fallbackLivePlugin(env),
    ],
    server: {
      port: 5173,
      open: false,
      watch: {
        followSymlinks: false,
        ignored: [
          "**/.gradle*/**",
          "**/.android-sdk/**",
          "**/.bootstrap/**",
          "**/.carmeleon-private/**",
          "**/verification/**",
          "**/build/**",
          "**/design/**",
          "**/android/**",
          "**/shared/**",
          "**/desktopApp/**",
        ],
      },
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
  };
});
