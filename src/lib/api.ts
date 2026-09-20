export type DriveVideo = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime: number;
  modifiedTime: number;
  folder: string;
};

export type FolderPayload = {
  id: string;
  title: string;
  videos: DriveVideo[];
};

export type SortKey = "name-asc" | "name-desc" | "new" | "old" | "big" | "small";

export function extractFolderId(input: string) {
  const raw = input.trim();
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

export async function fetchFolder(idOrUrl: string): Promise<FolderPayload> {
  const id = extractFolderId(idOrUrl);
  const response = await fetch(`/api/folder?id=${encodeURIComponent(id)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não consegui abrir a pasta.");
  return data;
}

export function thumbUrl(id: string) {
  return `/api/thumb/${encodeURIComponent(id)}`;
}

export type VideoQuality = {
  id: string;
  label: string;
};

export function streamUrl(video: DriveVideo, quality = "auto") {
  const params = new URLSearchParams({
    name: video.name,
    quality,
  });
  if (video.size) params.set("size", String(video.size));
  return `/api/stream/${encodeURIComponent(video.id)}?${params}`;
}

export async function fetchQualities(id: string): Promise<{ qualities: VideoQuality[]; preferred: string; error: string | null }> {
  try {
    const response = await fetch(`/api/qualities/${encodeURIComponent(id)}`);
    const data = await response.json();
    return {
      qualities: data.qualities?.length ? data.qualities : [{ id: "original", label: "Original" }],
      preferred: data.preferred || "auto",
      error: data.error || null,
    };
  } catch {
    return {
      qualities: [{ id: "original", label: "Original" }],
      preferred: "auto",
      error: null,
    };
  }
}

export function downloadUrl(video: DriveVideo) {
  const params = new URLSearchParams({ name: video.name });
  if (video.size) params.set("size", String(video.size));
  return `/api/download/${encodeURIComponent(video.id)}?${params}`;
}

export type StreamProgress = {
  downloaded: number;
  size: number;
  done: boolean;
  error: string | null;
  retrying: boolean;
  quota: boolean;
};

export async function fetchProgress(id: string): Promise<StreamProgress | null> {
  try {
    const response = await fetch(`/api/progress?id=${encodeURIComponent(id)}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(stamp: number) {
  if (!stamp) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(new Date(stamp));
}

export function displayTitle(name: string) {
  return name.replace(/\.[a-z0-9]{2,5}$/i, "");
}

function natural(a: string, b: string) {
  return a.localeCompare(b, "pt", { numeric: true, sensitivity: "base" });
}

export function sortVideos(videos: DriveVideo[], key: SortKey) {
  const copy = [...videos];
  copy.sort((a, b) => {
    if (key === "name-asc") return natural(a.name, b.name);
    if (key === "name-desc") return natural(b.name, a.name);
    if (key === "new") return (b.modifiedTime || 0) - (a.modifiedTime || 0);
    if (key === "old") return (a.modifiedTime || 0) - (b.modifiedTime || 0);
    if (key === "big") return (b.size || 0) - (a.size || 0);
    return (a.size || 0) - (b.size || 0);
  });
  return copy;
}

export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "name-asc", label: "Nome A–Z" },
  { id: "name-desc", label: "Nome Z–A" },
  { id: "new", label: "Mais recentes" },
  { id: "old", label: "Mais antigos" },
  { id: "big", label: "Maiores" },
  { id: "small", label: "Menores" },
];
