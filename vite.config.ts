// @ts-nocheck
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleApi } from "./server/drive.mjs";

function driveApi(): Plugin {
  const mount = (middlewares: { use: Function }) => {
    middlewares.use(async (req: any, res: any, next: any) => {
      try {
        if (await handleApi(req, res)) return;
      } catch (error) {
        console.error(error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end("Erro interno");
        }
        return;
      }
      next();
    });
  };

  return {
    name: "famiway-drive-api",
    configureServer(server) {
      mount(server.middlewares);
    },
    configurePreviewServer(server) {
      mount(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), driveApi()],
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
