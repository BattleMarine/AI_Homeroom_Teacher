import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = environment.API_PROXY_TARGET?.trim();

  if (mode === "development" && !apiProxyTarget) {
    throw new Error(
      "API_PROXY_TARGET 환경 변수가 필요합니다. 로컬 값은 docs/secrets/ 또는 .env.local에서 관리하세요.",
    );
  }

  return {
    plugins: [react()],
    server: apiProxyTarget
      ? {
          proxy: {
            "/api": {
              target: apiProxyTarget,
              changeOrigin: true,
            },
          },
        }
      : undefined,
  };
});
