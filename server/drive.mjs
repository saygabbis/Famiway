import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const VIDEO_EXT = /\.(mkv|mp4|webm|mov|m4v|avi|wmv|mpeg|mpg|m4a)$/i;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SLICE = 2 * 1024 * 1024;
const MAX_SUBFOLDER_DEPTH = 6;
const MAX_SUBFOLDERS = 200;
const CRAWL_CONCURRENCY = 4;

export function extractFolderId(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const patterns = [
    /\/folders\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/drive\/u\/\d+\/folders\/([a-zA-Z0-9_-]+)/,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1];
  }
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  return "";
}

function unescapeDriveString(value) {
  return value.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function isVideoFile(name = "", mime = "") {
  const type = mime.toLowerCase();
  if (type.startsWith("video/") || type.includes("matroska")) return true;
  return VIDEO_EXT.test(name);
}

function isFolder(mime = "") {
  return mime === FOLDER_MIME;
}

function parseIvd(html) {
  const match = html.match(/window\['_DRIVE_ivd'\]\s*=\s*'((?:\\.|[^'])*)'/);
  if (!match) return [];
  try {
    const data = JSON.parse(unescapeDriveString(match[1]));
    const rows = Array.isArray(data?.[0]) ? data[0] : [];
    return rows
      .filter((row) => Array.isArray(row) && typeof row[0] === "string")
      .map((row) => {
        const id = row[0];
        const name = String(row[2] || "Arquivo");
        const mimeType = String(row[3] || "");
        const createdTime = Number(row[9]) || 0;
        const modifiedTime = Number(row[10]) || createdTime;
        const size = Number(row[13]) || 0;
        return { id, name, mimeType, size, createdTime, modifiedTime };
      });
  } catch {
    return [];
  }
}

function parseHtmlFallback(html) {
  const videos = new Map();
  const tooltip = /data-id="([a-zA-Z0-9_-]{20,})"[^>]*data-tooltip="([^"]+)"/gi;
  const tooltipFlip = /data-tooltip="([^"]+)"[^>]*data-id="([a-zA-Z0-9_-]{20,})"/gi;
  const aria = /data-id="([a-zA-Z0-9_-]{20,})"[^>]*aria-label="([^"]+)"/gi;

  const push = (id, label) => {
    if (!id || videos.has(id)) return;
    const name = String(label)
      .replace(/\s+(Video|Vídeo|Shared|Compartilhado)\s*$/gi, "")
      .trim();
    if (!name) return;
    videos.set(id, {
      id,
      name,
      mimeType: /\.mkv$/i.test(name) ? "video/x-matroska" : VIDEO_EXT.test(name) ? "video/mp4" : "",
      size: 0,
      createdTime: 0,
      modifiedTime: 0,
    });
  };

  for (const match of html.matchAll(tooltip)) push(match[1], match[2]);
  for (const match of html.matchAll(tooltipFlip)) push(match[2], match[1]);
  for (const match of html.matchAll(aria)) push(match[1], match[2]);
  return [...videos.values()];
}

function folderTitle(html) {
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || "";
  return title.replace(/\s*-\s*Google Drive\s*$/i, "").trim();
}

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function guessMime(name = "", mime = "") {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "mkv" || /matroska/i.test(mime)) return "video/webm";
  if (mime && !mime.includes("octet-stream") && !mime.includes("text/html")) return mime;
  const map = {
    mkv: "video/webm",
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    wmv: "video/x-ms-wmv",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
  };
  return map[ext] || "video/mp4";
}

async function fetchFolderHtml(folderId) {
  const urls = [
    `https://drive.google.com/drive/folders/${folderId}?usp=sharing`,
    `https://drive.google.com/embeddedfolderview?id=${folderId}`,
  ];
  let lastError = "";
  for (const url of urls) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });
    const html = await response.text();
    if (response.ok && html.length > 1000) return html;
    lastError = `Drive respondeu ${response.status}`;
  }
  throw new Error(lastError || "Não consegui abrir a pasta do Drive.");
}

async function mapPool(items, limit, worker) {
  const results = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}

async function crawlFolderHtml(html, folderPath, depth, visited, budget) {
  const fromIvd = parseIvd(html);
  const entries = fromIvd.length ? fromIvd : parseHtmlFallback(html);

  const videos = entries
    .filter((entry) => isVideoFile(entry.name, entry.mimeType))
    .map((entry) => ({ ...entry, folder: folderPath }));

  if (depth < MAX_SUBFOLDER_DEPTH && fromIvd.length) {
    const subfolders = entries.filter((entry) => isFolder(entry.mimeType) && !visited.has(entry.id));
    const queue = [];
    for (const sub of subfolders) {
      if (visited.size >= budget.max) break;
      visited.add(sub.id);
      queue.push(sub);
    }
    const nested = await mapPool(queue, CRAWL_CONCURRENCY, async (sub) => {
      const childPath = folderPath ? `${folderPath}/${sub.name}` : sub.name;
      try {
        const childHtml = await fetchFolderHtml(sub.id);
        return await crawlFolderHtml(childHtml, childPath, depth + 1, visited, budget);
      } catch {
        return [];
      }
    });
    for (const list of nested) videos.push(...list);
  }

  return videos;
}

const folderCache = new Map();

export async function listFolder(folderId) {
  const cached = folderCache.get(folderId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const html = await fetchFolderHtml(folderId);
  const title = folderTitle(html) || "Pasta do Drive";
  const visited = new Set([folderId]);
  const videos = await crawlFolderHtml(html, "", 0, visited, { max: MAX_SUBFOLDERS });
  const seen = new Set();
  const unique = videos.filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
  const value = { id: folderId, title, videos: unique };
  folderCache.set(folderId, { expires: Date.now() + 2 * 60 * 1000, value });
  return value;
}

function parseConfirm(html) {
  const confirm =
    html.match(/name="confirm"\s+value="([^"]+)"/i)?.[1] || html.match(/confirm=([0-9A-Za-z_-]+)/)?.[1] || "t";
  const uuid =
    html.match(/name="uuid"\s+value="([^"]+)"/i)?.[1] || html.match(/[?&]uuid=([0-9A-Za-z_-]+)/)?.[1];
  const href = html.match(/id="uc-download-link"[^>]*href="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&");
  return { confirm, uuid, href };
}

function mediaOk(response) {
  const type = response.headers.get("content-type") || "";
  return (response.status === 200 || response.status === 206) && !type.includes("text/html");
}

function downloadUrlFor(fileId, confirm, uuid) {
  const url = new URL("https://drive.usercontent.google.com/download");
  url.searchParams.set("id", fileId);
  url.searchParams.set("export", "download");
  url.searchParams.set("confirm", confirm || "t");
  if (uuid) url.searchParams.set("uuid", uuid);
  return url.href;
}

function collectCookies(response, jar) {
  const raw = response.headers.getSetCookie?.() || [];
  for (const cookie of raw) {
    const part = cookie.split(";")[0];
    const [name] = part.split("=");
    if (name) jar.set(name, part);
  }
}

const sessions = new Map();
const sizeCache = new Map();

function sessionFor(fileId) {
  let session = sessions.get(fileId);
  if (!session || session.expires < Date.now()) {
    session = { jar: new Map(), confirm: "t", uuid: "", expires: Date.now() + 25 * 60 * 1000 };
    sessions.set(fileId, session);
  }
  return session;
}

function normalizeRange(rangeHeader, knownSize = 0) {
  const size = Number(knownSize) || 0;
  const parsed = String(rangeHeader || "").match(/bytes=(\d*)-(\d*)/i);
  const start = parsed?.[1] ? Number(parsed[1]) : 0;
  const hasEnd = Boolean(parsed?.[2]);
  let end = hasEnd ? Number(parsed[2]) : start + SLICE - 1;
  if (!hasEnd || end - start + 1 > SLICE * 4) {
    // Limita o primeiro pedaço pra o Drive não recusar e o player começar rápido.
    end = start + SLICE - 1;
  }
  if (size > 0) end = Math.min(end, size - 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { header: `bytes=0-${SLICE - 1}`, start: 0, end: SLICE - 1 };
  }
  return { header: `bytes=${start}-${end}`, start, end };
}

async function driveFetch(url, headers, jar, hops = 0) {
  if (hops > 8) throw new Error("O Drive redirecionou demais.");
  const response = await fetch(url, {
    headers: { ...headers, Cookie: [...jar.values()].join("; ") },
    redirect: "manual",
  });
  collectCookies(response, jar);
  const location = response.headers.get("location");
  if (location && response.status >= 300 && response.status < 400) {
    try {
      await response.body?.cancel?.();
    } catch {
      /* ignore */
    }
    return driveFetch(new URL(location, url).href, headers, jar, hops + 1);
  }
  return response;
}

async function openDriveMedia(fileId, rangeHeader, knownSize = 0) {
  const session = sessionFor(fileId);
  const known = knownSize || sizeCache.get(fileId) || 0;
  let { header, start, end } = normalizeRange(rangeHeader, known);
  let lastQuota = false;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headers = {
      "User-Agent": UA,
      Accept: "*/*",
      Referer: "https://drive.google.com/",
      Range: header,
    };
    const urls = [
      downloadUrlFor(fileId, session.confirm, session.uuid),
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=${encodeURIComponent(session.confirm || "t")}`,
    ];

    for (const url of urls) {
      let response;
      try {
        response = await driveFetch(url, headers, session.jar);
      } catch {
        continue;
      }
      if (mediaOk(response)) {
        session.expires = Date.now() + 25 * 60 * 1000;
        const cr = response.headers.get("content-range") || "";
        const total = Number(cr.split("/")[1]);
        if (Number.isFinite(total) && total > 0) sizeCache.set(fileId, total);
        return response;
      }

      const html = await response.text();
      lastQuota = /quota exceeded/i.test(html);
      const { confirm, uuid, href } = parseConfirm(html);
      session.confirm = confirm || session.confirm;
      if (uuid) session.uuid = uuid;

      const retryUrl = href ? new URL(href, "https://drive.google.com/").href : downloadUrlFor(fileId, session.confirm, session.uuid);
      let retry;
      try {
        retry = await driveFetch(retryUrl, headers, session.jar);
      } catch {
        continue;
      }
      if (mediaOk(retry)) {
        session.expires = Date.now() + 25 * 60 * 1000;
        const cr = retry.headers.get("content-range") || "";
        const total = Number(cr.split("/")[1]);
        if (Number.isFinite(total) && total > 0) sizeCache.set(fileId, total);
        return retry;
      }
      try {
        await retry.body?.cancel?.();
      } catch {
        /* ignore */
      }

      if (lastQuota && end - start > 64 * 1024) {
        end = start + 64 * 1024 - 1;
        header = `bytes=${start}-${end}`;
        break;
      }
    }
  }

  const err = new Error(
    lastQuota
      ? "O Google Drive limitou este arquivo por agora. Tenta de novo daqui a pouco."
      : "O Drive bloqueou o stream deste arquivo."
  );
  err.quota = lastQuota;
  throw err;
}

const ITAG_LABEL = {
  17: "144p",
  18: "360p",
  22: "720p",
  36: "240p",
  37: "1080p",
  59: "480p",
  78: "480p",
};

const INFO_KEYS =
  "fmt_list|fmt_stream_map|url_encoded_fmt_stream_map|adaptive_fmts|hlsvp|dashmpd|status|title|length_seconds|token|ttsurl|player_response|iurl|timestamp|plid|reportabuseurl|BASE_URL|docid|hl|ps|el|abd|autoplay|allow_embed|partnerid|cc3_module|reason|errorcode|suberrorcode";

const qualityCache = new Map();
const infoInflight = new Map();

function extractInfoField(body, key) {
  const token = `${key}=`;
  const start = body.indexOf(token);
  if (start < 0) return "";
  const from = start + token.length;
  const next = body.slice(from).match(new RegExp(`&(?:${INFO_KEYS})=`));
  const raw = body.slice(from, next ? from + next.index : body.length);
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw.replace(/\+/g, " ");
  }
}

function parseFmtStreamMap(map) {
  const found = new Map();
  if (!map) return found;
  for (const part of map.split(",")) {
    if (!part.includes("|")) continue;
    const itag = part.slice(0, part.indexOf("|"));
    const src = part.slice(itag.length + 1);
    const label = ITAG_LABEL[Number(itag)];
    if (!label || !/^https?:\/\//.test(src)) continue;
    found.set(String(itag), { id: String(itag), label, src });
  }
  return found;
}

function parseEncodedFmtMap(encoded) {
  const found = new Map();
  if (!encoded) return found;
  for (const part of encoded.split(",")) {
    const params = new URLSearchParams(part);
    const itag = params.get("itag");
    const src = params.get("url");
    const label = ITAG_LABEL[Number(itag)];
    if (!label || !src || !/^https?:\/\//.test(src)) continue;
    found.set(String(itag), { id: String(itag), label, src });
  }
  return found;
}

async function warmDriveSession(fileId, jar = new Map()) {
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    Referer: "https://drive.google.com/",
  };
  if (jar.size) headers.Cookie = [...jar.values()].join("; ");
  try {
    const response = await fetch(`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`, {
      headers,
      redirect: "follow",
    });
    collectCookies(response, jar);
  } catch {
    /* ignore */
  }
  return jar;
}

function streamsFromInfoBody(body) {
  return new Map([
    ...parseFmtStreamMap(extractInfoField(body, "fmt_stream_map")),
    ...parseEncodedFmtMap(extractInfoField(body, "url_encoded_fmt_stream_map")),
  ]);
}

async function fetchVideoInfoOnce(fileId) {
  const jar = await warmDriveSession(fileId);
  const headers = {
    "User-Agent": UA,
    Accept: "*/*",
    Referer: `https://drive.google.com/file/d/${fileId}/view`,
  };
  if (jar.size) headers.Cookie = [...jar.values()].join("; ");

  // Uma tentativa só — cada hit conta pra cota de preview do Google.
  const queries = [`docid=${encodeURIComponent(fileId)}&hl=en&el=detailpage&authuser=0`];

  let lastReason = "";
  let hitQuota = false;

  for (const query of queries) {
    let response;
    try {
      response = await fetch(`https://drive.google.com/get_video_info?${query}`, {
        headers,
        redirect: "follow",
      });
    } catch {
      continue;
    }
    collectCookies(response, jar);
    const body = await response.text();
    const status = extractInfoField(body, "status") || "";
    if (status !== "ok") {
      lastReason = extractInfoField(body, "reason") || lastReason;
      hitQuota = /exceeded|playback|errorcode=150/i.test(body) || /exceeded|playback/i.test(lastReason);
      if (hitQuota) break;
      continue;
    }

    const found = streamsFromInfoBody(body);
    if (!found.size) {
      lastReason = "O Drive ainda não gerou preview transcodificada deste arquivo.";
      continue;
    }

    return {
      streams: [...found.values()].sort((a, b) => Number.parseInt(a.label) - Number.parseInt(b.label)),
      jar,
      lengthSeconds: Number(extractInfoField(body, "length_seconds")) || 0,
    };
  }

  const err = new Error(
    hitQuota || /exceeded|playback/i.test(lastReason)
      ? "O Google limitou as previews deste vídeo por agora. Espera um pouco e tenta de novo."
      : lastReason || "Não consegui abrir a preview do Drive."
  );
  err.preview = true;
  err.quota = hitQuota || /exceeded|playback/i.test(lastReason);
  throw err;
}

function fetchVideoInfo(fileId) {
  const existing = infoInflight.get(fileId);
  if (existing) return existing;
  const pending = fetchVideoInfoOnce(fileId).finally(() => {
    infoInflight.delete(fileId);
  });
  infoInflight.set(fileId, pending);
  return pending;
}

async function probeQualities(fileId) {
  const cached = qualityCache.get(fileId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const original = [{ id: "original", label: "Original" }];
  try {
    const { streams } = await fetchVideoInfo(fileId);
    const value = [...streams.map(({ id, label, src }) => ({ id, label, src })), ...original];
    qualityCache.set(fileId, { expires: Date.now() + 12 * 60 * 1000, value });
    return value;
  } catch (error) {
    const value = [...original];
    value.error = error.message;
    value.quota = Boolean(error.quota);
    // Cota: não martela o Google de novo a cada clique.
    const ttl = error.quota ? 15 * 60 * 1000 : 90 * 1000;
    qualityCache.set(fileId, { expires: Date.now() + ttl, value });
    return value;
  }
}

function bestPreviewQuality(qualities) {
  const previews = (qualities || []).filter((item) => item.id !== "original" && item.src);
  if (!previews.length) return null;
  return previews[previews.length - 1];
}

async function openQualityUrl(src, range) {
  const headers = {
    "User-Agent": UA,
    Accept: "*/*",
    Referer: "https://drive.google.com/",
  };
  if (range) headers.Range = range;
  return fetch(src, { headers, redirect: "follow" });
}

async function pipeQualityStream(req, res, fileId, quality, { filename = "", download = false } = {}) {
  const match = (await probeQualities(fileId)).find((item) => item.id === quality && item.src);
  if (!match?.src) throw new Error("Qualidade indisponível.");
  const known = sizeCache.get(fileId) || 0;
  const { header } = normalizeRange(req.headers.range, known);
  const upstream = await openQualityUrl(match.src, header);
  const type = upstream.headers.get("content-type") || "";
  if (type.includes("text/html")) throw new Error("O Drive devolveu a página de aviso em vez do vídeo.");

  res.statusCode = upstream.status === 206 ? 206 : 200;
  const length = upstream.headers.get("content-length");
  const contentRange = upstream.headers.get("content-range");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", type || "video/mp4");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (length) res.setHeader("Content-Length", length);
  if (contentRange) {
    res.statusCode = 206;
    res.setHeader("Content-Range", contentRange);
  }
  if (download) {
    const safe = (filename || `video-${fileId}`).replace(/"/g, "");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  }
  if (req.method === "HEAD" || !upstream.body) {
    res.end();
    return;
  }
  const nodeStream = Readable.fromWeb(upstream.body);
  const onClose = () => {
    if (!nodeStream.destroyed) nodeStream.destroy();
  };
  req.on("close", onClose);
  try {
    await pipeline(nodeStream, res);
  } catch {
    /* cliente fechou o vídeo */
  } finally {
    req.off("close", onClose);
  }
}

async function pipeMedia(req, res, fileId, { download = false, filename = "", quality = "auto", size = 0 } = {}) {
  const wantOriginal = quality === "original" || download;
  const wantNamed = Boolean(quality) && quality !== "original" && quality !== "auto";

  if (!wantOriginal || wantNamed) {
    try {
      const qualities = await probeQualities(fileId);
      const pick = wantNamed
        ? qualities.find((item) => item.id === quality && item.src)
        : bestPreviewQuality(qualities);
      if (pick?.src) {
        await pipeQualityStream(req, res, fileId, pick.id, { filename, download });
        return;
      }
    } catch {
      /* cai no arquivo original */
    }
  }

  const known = Number(size) || sizeCache.get(fileId) || 0;
  const asked = normalizeRange(req.headers.range, known);
  const upstream = await openDriveMedia(fileId, asked.header, known);
  const upstreamType = upstream.headers.get("content-type") || "";
  if (upstreamType.includes("text/html")) {
    throw new Error("O Drive devolveu a página de aviso em vez do vídeo.");
  }

  const length = Number(upstream.headers.get("content-length")) || 0;
  const rawRange = upstream.headers.get("content-range") || "";
  const parsed = rawRange.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
  const start = parsed ? Number(parsed[1]) : asked.start;
  const end = parsed ? Number(parsed[2]) : asked.end;
  let total = "*";
  if (parsed && parsed[3] !== "*") {
    total = Number(parsed[3]);
    sizeCache.set(fileId, total);
  } else if (known > 0) {
    total = known;
  }

  res.statusCode = 206;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", guessMime(filename, upstreamType));
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
  res.setHeader("Content-Length", String(length || end - start + 1));
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, Content-Type");
  if (download) {
    const safe = (filename || `video-${fileId}`).replace(/"/g, "");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  }

  if (req.method === "HEAD") {
    res.end();
    await upstream.body?.cancel?.();
    return;
  }
  if (!upstream.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(upstream.body);
  const onClose = () => {
    if (!nodeStream.destroyed) nodeStream.destroy();
  };
  req.on("close", onClose);
  try {
    await pipeline(nodeStream, res);
  } catch {
    /* cliente fechou */
  } finally {
    req.off("close", onClose);
  }
}

async function pipeThumb(res, fileId) {
  const urls = [
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w480`,
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w480`,
  ];
  for (const url of urls) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "image/*" },
      redirect: "follow",
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.startsWith("image/")) continue;
    res.statusCode = 200;
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const length = response.headers.get("content-length");
    if (length) res.setHeader("Content-Length", length);
    if (!response.body) {
      res.end();
      return;
    }
    await pipeline(Readable.fromWeb(response.body), res);
    return;
  }
  res.statusCode = 404;
  res.end();
}

function readUrl(req) {
  return new URL(req.url, "http://local.host");
}

export async function handleApi(req, res) {
  const url = readUrl(req);
  if (!url.pathname.startsWith("/api/")) return false;

  if (url.pathname === "/api/folder") {
    const folderId = extractFolderId(url.searchParams.get("id") || url.searchParams.get("url") || "");
    if (!folderId) {
      json(res, 400, { error: "Cole um link válido de pasta do Google Drive." });
      return true;
    }
    try {
      const data = await listFolder(folderId);
      json(res, 200, data);
    } catch (error) {
      json(res, 502, { error: error.message || "Não consegui ler essa pasta." });
    }
    return true;
  }

  // Mantido só pra não quebrar o front antigo; não há mais download em background.
  if (url.pathname === "/api/progress") {
    json(res, 200, {
      downloaded: 0,
      size: Number(url.searchParams.get("size")) || sizeCache.get(url.searchParams.get("id") || "") || 0,
      done: false,
      error: null,
      retrying: false,
      quota: false,
    });
    return true;
  }

  const thumb = url.pathname.match(/^\/api\/thumb\/([a-zA-Z0-9_-]+)$/);
  if (thumb) {
    try {
      await pipeThumb(res, thumb[1]);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 404;
        res.end();
      }
    }
    return true;
  }

  const qualities = url.pathname.match(/^\/api\/qualities\/([a-zA-Z0-9_-]+)$/);
  if (qualities) {
    try {
      const items = await probeQualities(qualities[1]);
      const previews = items.filter((item) => item.id !== "original" && item.src);
      const preferred = bestPreviewQuality(items)?.id || "auto";
      json(res, 200, {
        preferred,
        error: items.error || null,
        qualities: [
          ...previews.map(({ id, label }) => ({ id, label })),
          { id: "original", label: "Original" },
        ],
      });
    } catch (error) {
      json(res, 200, {
        preferred: "auto",
        error: error.message || null,
        qualities: [{ id: "original", label: "Original" }],
      });
    }
    return true;
  }

  const stream = url.pathname.match(/^\/api\/stream\/([a-zA-Z0-9_-]+)$/);
  if (stream) {
    try {
      await pipeMedia(req, res, stream[1], {
        filename: url.searchParams.get("name") || "",
        quality: url.searchParams.get("quality") || "auto",
        size: Number(url.searchParams.get("size")) || 0,
      });
    } catch (error) {
      if (!res.headersSent) json(res, 502, { error: error.message || "Falha ao abrir o vídeo." });
    }
    return true;
  }

  const download = url.pathname.match(/^\/api\/download\/([a-zA-Z0-9_-]+)$/);
  if (download) {
    try {
      await pipeMedia(req, res, download[1], {
        download: true,
        filename: url.searchParams.get("name") || "",
        size: Number(url.searchParams.get("size")) || 0,
      });
    } catch (error) {
      if (!res.headersSent) json(res, 502, { error: error.message || "Falha ao baixar o vídeo." });
    }
    return true;
  }

  json(res, 404, { error: "Rota não encontrada." });
  return true;
}
