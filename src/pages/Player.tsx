import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import JellyPlayer from "../components/JellyPlayer";
import { displayTitle, formatBytes, type DriveVideo } from "../lib/api";

type Props = {
  video: DriveVideo;
  onBack: () => void;
};

export default function Player({ video, onBack }: Props) {
  const [failed, setFailed] = useState(false);

  return (
    <motion.section
      className="player-page"
      initial={{ opacity: 0, y: 28, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -16, filter: "blur(8px)" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="player-top">
        <button className="ghost" type="button" onClick={onBack} aria-label="Voltar para a lista">
          <ChevronLeft size={22} />
        </button>
        <h1>{displayTitle(video.name)}</h1>
      </div>
      <JellyPlayer video={video} onFail={setFailed} />
      {failed ? (
        <p className="warn">
          Ainda não consegui abrir este arquivo ({formatBytes(video.size) || "grande"}). Tenta de novo.
        </p>
      ) : null}
    </motion.section>
  );
}
