import { defineConfig, loadEnv, type UserConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(async ({ command, mode }) => {
  // Expõe variáveis VITE_* como substituições estáticas. Além dos arquivos
  // .env (loadEnv), também consideramos process.env, pois plataformas de
  // build injetam as variáveis apenas como env vars do processo.
  const fileEnv = loadEnv(mode, process.cwd(), "VITE_");
  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key.startsWith("VITE_") && typeof value === "string" && value !== "",
    ),
  ) as Record<string, string>;
  const env = { ...fileEnv, ...processEnv };
  const define: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    define[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  // VERCEL_ENV ("production" | "preview" | "development") é injetada pela
  // Vercel automaticamente em todo build, sem configuração no painel — só
  // não chega ao bundle do cliente por padrão (Vite só embute VITE_*).
  // Exposta aqui para o cliente recusar o fallback de produção de
  // public-config.ts quando estiver em Preview sem as env vars corretas.
  const vercelEnv = process.env["VERCEL_ENV"];
  if (vercelEnv && !define["import.meta.env.VITE_APP_ENV"]) {
    define["import.meta.env.VITE_APP_ENV"] = JSON.stringify(vercelEnv);
  }


  const isDevBuild = command === "build" && mode === "development";

  const devBuildConfig: UserConfig = isDevBuild
    ? {
        environments: {
          client: {
            define: { "process.env.NODE_ENV": JSON.stringify("development") },
          },
        },
      }
    : {};

  return {
    define,
    ...devBuildConfig,
    resolve: {
      alias: { "@": srcDir },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    server: {
      host: "::",
      port: 8080,
      strictPort: true,
      hmr: { overlay: false },
    },
    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        server: { entry: "server" },
        importProtection: {
          behavior: "error",
          client: {
            files: ["**/server/**"],
            specifiers: ["server-only"],
          },
        },
      }),
      ...(command === "build"
        ? [
            // Preset agnóstico de plataforma. No build da plataforma de deploy
            // (Vercel, Netlify, etc.) o Nitro detecta o alvo automaticamente e
            // escreve na saída esperada (ex.: `.vercel/output`). Localmente cai
            // no preset padrão (`node-server` em `.output/`). Para forçar um
            // alvo específico, defina a env `NITRO_PRESET`.
            nitro(
              process.env["NITRO_PRESET"]
                ? { preset: process.env["NITRO_PRESET"] }
                : {},
            ),
          ]
        : []),
      react(),
    ],
  };
});
