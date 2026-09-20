import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import Background from "./components/Background";
import Home from "./pages/Home";
import Library from "./pages/Library";
import Player from "./pages/Player";
import { extractFolderId, fetchFolder, type DriveVideo, type FolderPayload } from "./lib/api";

function readParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    folder: params.get("folder") || "",
    watch: params.get("watch") || "",
  };
}

function writeParams(folder: string, watch = "") {
  const params = new URLSearchParams();
  if (folder) params.set("folder", folder);
  if (watch) params.set("watch", watch);
  const next = params.toString();
  const url = next ? `?${next}` : "/";
  window.history.pushState({ folder, watch }, "", url);
}

export default function App() {
  const initial = useMemo(readParams, []);
  const [folder, setFolder] = useState<FolderPayload | null>(null);
  const [watch, setWatch] = useState(initial.watch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openFolder(value: string, nextWatch = "") {
    const id = extractFolderId(value);
    if (!id) {
      setError("Esse link não parece uma pasta do Drive.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await fetchFolder(id);
      setFolder(data);
      setWatch(nextWatch);
      writeParams(data.id, nextWatch);
      window.localStorage.setItem("famiway:last-folder", data.id);
    } catch (err) {
      setFolder(null);
      setError(err instanceof Error ? err.message : "Não consegui abrir a pasta.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initial.folder) {
      void openFolder(initial.folder, initial.watch);
    }
  }, [initial.folder, initial.watch]);

  useEffect(() => {
    const onPop = () => {
      const next = readParams();
      if (!next.folder) {
        setFolder(null);
        setWatch("");
        return;
      }
      if (!folder || folder.id !== next.folder) {
        void openFolder(next.folder, next.watch);
        return;
      }
      setWatch(next.watch);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [folder]);

  const video = folder?.videos.find((item) => item.id === watch) || null;
  const view = video ? "player" : folder ? "library" : "home";

  function openVideo(item: DriveVideo) {
    if (!folder) return;
    setWatch(item.id);
    writeParams(folder.id, item.id);
  }

  function backToLibrary() {
    if (!folder) return;
    setWatch("");
    writeParams(folder.id);
  }

  function backHome() {
    setFolder(null);
    setWatch("");
    writeParams("");
  }

  return (
    <div className="app">
      <Background view={view} />
      <main className="stage">
        {busy && !folder ? <p className="loading">Abrindo a pasta do Drive…</p> : null}
        <AnimatePresence mode="wait">
          {view === "home" && !busy ? (
            <Home key="home" onOpen={openFolder} busy={busy} error={error} />
          ) : null}
          {view === "library" && folder ? (
            <Library key="library" folder={folder} onBack={backHome} onOpen={openVideo} />
          ) : null}
          {view === "player" && video ? (
            <Player key={video.id} video={video} onBack={backToLibrary} />
          ) : null}
        </AnimatePresence>
      </main>
    </div>
  );
}
