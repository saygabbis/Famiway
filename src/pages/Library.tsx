import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Search, SlidersHorizontal } from "lucide-react";
import VideoCard from "../components/VideoCard";
import { SORT_OPTIONS, sortVideos, type DriveVideo, type FolderPayload, type SortKey } from "../lib/api";

type Props = {
  folder: FolderPayload;
  onBack: () => void;
  onOpen: (video: DriveVideo) => void;
};

export default function Library({ folder, onBack, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name-asc");
  const [openFilter, setOpenFilter] = useState(false);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);

  const hasSubfolders = useMemo(() => folder.videos.some((video) => video.folder), [folder.videos]);

  const videos = useMemo(() => {
    const filtered = folder.videos.filter((video) => {
      if (!includeSubfolders && video.folder) return false;
      return video.name.toLowerCase().includes(query.trim().toLowerCase());
    });
    return sortVideos(filtered, sort);
  }, [folder.videos, query, sort, includeSubfolders]);

  return (
    <motion.section
      className="library"
      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -18, filter: "blur(8px)" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="topbar">
        <motion.button className="ghost" type="button" onClick={onBack} aria-label="Voltar" whileTap={{ scale: 0.92 }}>
          <ChevronLeft size={22} />
        </motion.button>
        <label className="top-search">
          <Search size={16} color="#8b8493" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar pelo título"
            aria-label="Buscar vídeos pelo título"
          />
        </label>
        <motion.button
          className={`ghost ${openFilter ? "is-on" : ""}`}
          type="button"
          onClick={() => setOpenFilter(true)}
          aria-label="Filtrar ordem"
          whileTap={{ scale: 0.92 }}
        >
          <SlidersHorizontal size={18} />
        </motion.button>
      </div>

      {folder.title ? <p className="folder-name">{folder.title}</p> : null}

      {videos.length ? (
        <div className="list">
          {videos.map((video, index) => (
            <VideoCard key={video.id} video={video} index={index} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <p className="empty">{folder.videos.length ? "Nenhum título combina com a busca." : "Nenhum vídeo nessa pasta."}</p>
      )}

      <AnimatePresence>
        {openFilter ? (
          <>
            <motion.button
              className="sheet-backdrop"
              type="button"
              aria-label="Fechar filtros"
              onClick={() => setOpenFilter(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              className="sheet"
              initial={{ y: 28, opacity: 0, scale: 0.96 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 320, damping: 22 }}
            >
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={sort === option.id ? "active" : ""}
                  onClick={() => {
                    setSort(option.id);
                    setOpenFilter(false);
                  }}
                >
                  {option.label}
                </button>
              ))}
              {hasSubfolders ? (
                <>
                  <div className="sheet-divider" />
                  <button
                    type="button"
                    className={includeSubfolders ? "active" : ""}
                    onClick={() => setIncludeSubfolders((on) => !on)}
                  >
                    {includeSubfolders ? "Mostrando subpastas" : "Só a pasta atual"}
                  </button>
                </>
              ) : null}
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}
