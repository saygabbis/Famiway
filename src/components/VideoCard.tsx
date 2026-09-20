import { useState } from "react";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { displayTitle, formatBytes, formatDate, thumbUrl, type DriveVideo } from "../lib/api";

type Props = {
  video: DriveVideo;
  index: number;
  onOpen: (video: DriveVideo) => void;
};

export default function VideoCard({ video, index, onOpen }: Props) {
  const [broken, setBroken] = useState(false);
  const meta = [video.folder, formatBytes(video.size), formatDate(video.modifiedTime)].filter(Boolean).join(" • ");

  return (
    <motion.button
      className="card"
      type="button"
      onClick={() => onOpen(video)}
      initial={{ opacity: 0, y: 22, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: Math.min(index * 0.06, 0.4), type: "spring", stiffness: 240, damping: 20 }}
      whileHover={{ y: -6 }}
      whileTap={{ scale: 0.985 }}
    >
      <div className="thumb">
        {broken ? (
          <div className="fallback">
            <Play size={28} />
          </div>
        ) : (
          <img src={thumbUrl(video.id)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        )}
        <span className="thumb-veil" />
        <span className="play-badge">
          <Play size={16} fill="currentColor" />
        </span>
      </div>
      <div className="card-copy">
        <h3>{displayTitle(video.name)}</h3>
        {meta ? <p className="meta">{meta}</p> : null}
      </div>
    </motion.button>
  );
}
