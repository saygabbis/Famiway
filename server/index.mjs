import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./drive.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || "0.0.0.0";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    if (await handleApi(req, res)) return;
    const url = new URL(req.url || "/", "http://local.host");
    let filePath = path.join(root, decodeURIComponent(url.pathname));
    if (url.pathname === "/" || !(await exists(filePath))) {
      filePath = path.join(root, "index.html");
    }
    const info = await stat(filePath);
    if (!info.isFile()) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    res.setHeader("Content-Type", mime[path.extname(filePath)] || "application/octet-stream");
    createReadStream(filePath).pipe(res);
  } catch {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("Erro interno");
    }
  }
});

async function exists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

function networkUrls(listenPort) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const item of entries || []) {
      const family = String(item.family);
      if ((family !== "IPv4" && family !== "4") || item.internal) continue;
      urls.push(`http://${item.address}:${listenPort}/`);
    }
  }
  return urls;
}

server.listen(port, host, () => {
  console.log("");
  console.log(`  Famiway ready`);
  console.log(`  ➜  Local:   http://localhost:${port}/`);
  for (const url of networkUrls(port)) {
    console.log(`  ➜  Network: ${url}`);
  }
  console.log("");
});
