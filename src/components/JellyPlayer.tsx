import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Download, Maximize, Pause, PictureInPicture2, Play, Repeat, Settings, Volume2, VolumeX } from "lucide-react";
import { downloadUrl, fetchQualities, formatBytes, streamUrl, type DriveVideo, type VideoQuality } from "../lib/api";

type Props = {
  video: DriveVideo;
  onFail: (message: string | null) => void;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const min = Math.floor((seconds % 3600) / 60);
  const sec = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return hrs ? `${hrs}:${min.toString().padStart(2, "0")}:${sec}` : `${min}:${sec}`;
}

function readSpeed() {
  const raw = Number(window.localStorage.getItem("famiway:speed") || 1);
  return SPEEDS.includes(raw) ? raw : 1;
}

function isCoarsePointer() {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

export default function JellyPlayer({ video, onFail }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const hide = useRef<number>(0);
  const flashTimer = useRef<number>(0);
  const resume = useRef(0);
  const retried = useRef(false);
  const showRef = useRef(true);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [show, setShow] = useState(true);
  const [settings, setSettings] = useState(false);
  const [speed, setSpeed] = useState(readSpeed);
  const [loop, setLoop] = useState(() => window.localStorage.getItem("famiway:loop") === "1");
  const [quality, setQuality] = useState("original");
  const [qualities, setQualities] = useState<VideoQuality[]>([{ id: "original", label: "Original" }]);
  const [bufferedPct, setBufferedPct] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [flash, setFlash] = useState<"play" | "pause" | null>(null);
  const [flashKey, setFlashKey] = useState(0);

  useEffect(() => {
    showRef.current = show;
  }, [show]);

  useEffect(() => {
    retried.current = false;
    onFail(null);
    setBuffering(true);
    setFlash(null);
    setQualities([{ id: "original", label: "Original" }]);
    setQuality("original");
    const node = ref.current;
    if (!node) return;
    node.playbackRate = speed;
    node.loop = loop;
    const play = node.play();
    if (play) play.catch(() => setPlaying(false));
  }, [video.id]);

  useEffect(() => {
    if (!settings) return;
    let alive = true;
    void fetchQualities(video.id).then((items) => {
      if (alive) setQualities(items);
    });
    return () => {
      alive = false;
    };
  }, [settings, video.id]);

  useEffect(() => {
    if (quality === "original") return;
    retried.current = false;
    setBuffering(true);
    const node = ref.current;
    if (!node) return;
    node.playbackRate = speed;
    node.loop = loop;
    const play = node.play();
    if (play) play.catch(() => setPlaying(false));
  }, [quality]);

  useEffect(() => {
    const node = ref.current;
    if (node) node.playbackRate = speed;
    window.localStorage.setItem("famiway:speed", String(speed));
  }, [speed]);

  useEffect(() => {
    const node = ref.current;
    if (node) node.loop = loop;
    window.localStorage.setItem("famiway:loop", loop ? "1" : "0");
  }, [loop]);

  function scheduleHide() {
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => {
      if (!ref.current?.paused && !settings) setShow(false);
    }, 2600);
  }

  function poke() {
    setShow(true);
    scheduleHide();
  }

  function flashIcon(kind: "play" | "pause") {
    setFlash(kind);
    setFlashKey((n) => n + 1);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 520);
  }

  function toggle(showFlash = true) {
    const node = ref.current;
    if (!node) return;
    if (node.paused) {
      if (showFlash) flashIcon("play");
      node.play().catch(() => setPlaying(false));
    } else {
      if (showFlash) flashIcon("pause");
      node.pause();
    }
    setShow(true);
    scheduleHide();
  }

  function onSurfaceTap(event: ReactPointerEvent) {
    if ((event.target as HTMLElement).closest(".controls, .settings-menu, .center-play, .buffer-overlay")) return;
    event.preventDefault();

    // Mobile: primeiro toque só revela os controles; se já estão abertos, pausa/play.
    if (isCoarsePointer()) {
      if (!showRef.current) {
        poke();
        return;
      }
      toggle(true);
      return;
    }

    // Desktop: clique em qualquer lugar do vídeo pausa/play + ícone no meio.
    toggle(true);
  }

  function changeQuality(next: string) {
    const node = ref.current;
    resume.current = node?.currentTime || 0;
    setQuality(next);
  }

  function updateBuffered() {
    const node = ref.current;
    if (!node || !node.duration) return;
    try {
      const len = node.buffered.length;
      if (len > 0) {
        const end = node.buffered.end(len - 1);
        setBufferedPct(Math.min(100, (end / node.duration) * 100));
      }
    } catch {
      /* ignore */
    }
  }

  async function pip() {
    const node = ref.current;
    if (!node || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await node.requestPictureInPicture();
    } catch {
      /* ignore */
    }
  }

  const showLoading = buffering;
  const showIdlePlay = !playing && !showLoading && !flash;

  return (
    <div
      className={`player-shell ${show || !playing || settings ? "show-controls" : ""}`}
        onPointerMove={() => {
        if (!isCoarsePointer() && playing) poke();
      }}
    >
      <video
        key={`${video.id}-${quality}`}
        ref={ref}
        src={streamUrl(video, quality)}
        playsInline
        loop={loop}
        preload="auto"
        onPlay={() => {
          setPlaying(true);
          onFail(null);
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setCurrent(ref.current?.currentTime || 0)}
        onProgress={updateBuffered}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onLoadedMetadata={() => {
          const node = ref.current;
          if (!node) return;
          node.playbackRate = speed;
          node.loop = loop;
          if (resume.current > 0) {
            node.currentTime = resume.current;
            resume.current = 0;
          }
          setDuration(node.duration || 0);
          updateBuffered();
        }}
        onError={() => {
          const node = ref.current;
          const code = node?.error?.code;
          if (!code || code === MediaError.MEDIA_ERR_ABORTED) return;
          if (!retried.current) {
            retried.current = true;
            window.setTimeout(() => {
              node?.load();
              node?.play().catch(() => setPlaying(false));
            }, 1200);
            return;
          }
          void (async () => {
            try {
              const response = await fetch(streamUrl(video, quality), {
                headers: { Range: "bytes=0-1023" },
              });
              const type = response.headers.get("content-type") || "";
              if (type.includes("json")) {
                const data = await response.json();
                onFail(data.error || "Não consegui abrir este vídeo.");
                return;
              }
            } catch {
              /* ignore */
            }
            onFail(`Não consegui abrir este arquivo (${formatBytes(video.size) || "grande"}). Tenta de novo daqui a pouco.`);
          })();
        }}
      />

      <button type="button" className="tap-layer" aria-label="Alternar reprodução" onPointerUp={onSurfaceTap} />

      {showLoading ? (
        <div className="buffer-overlay">
          <span className="spinner" />
          <p>Carregando vídeo…</p>
        </div>
      ) : null}

      {flash ? (
        <div className="center-flash" key={flashKey} aria-hidden>
          {flash === "play" ? <Play size={34} fill="currentColor" /> : <Pause size={34} fill="currentColor" />}
        </div>
      ) : null}

      {showIdlePlay ? (
        <button type="button" className="center-play" onClick={() => toggle(false)} aria-label="Reproduzir">
          <Play size={28} fill="currentColor" />
        </button>
      ) : null}

      <div
        className="controls"
        onPointerDown={(event) => {
          event.stopPropagation();
          poke();
        }}
      >
        <div className="progress-wrap">
          <div className="progress-buffered" style={{ width: `${bufferedPct}%` }} />
          <input
            className="progress"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            style={{ ["--progress" as string]: duration ? `${(current / duration) * 100}%` : "0%" }}
            onChange={(event) => {
              const node = ref.current;
              if (!node) return;
              node.currentTime = Number(event.target.value);
              setCurrent(node.currentTime);
            }}
          />
        </div>
        <div className="row">
          <button className="ghost" type="button" onClick={() => toggle(false)} aria-label={playing ? "Pausar" : "Reproduzir"}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              const node = ref.current;
              if (!node) return;
              node.muted = !node.muted;
              setMuted(node.muted);
            }}
            aria-label={muted ? "Ativar som" : "Silenciar"}
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <time>
            {clock(current)} / {clock(duration)}
          </time>
          <span style={{ flex: 1 }} />
          <div className="settings-wrap">
            <button
              className={`ghost ${settings ? "is-on" : ""}`}
              type="button"
              aria-label="Configurações de reprodução"
              aria-expanded={settings}
              onClick={(event) => {
                event.stopPropagation();
                setSettings((open) => !open);
                setShow(true);
              }}
            >
              <Settings size={16} />
            </button>
            {settings ? (
              <div className="settings-menu" onPointerDown={(event) => event.stopPropagation()}>
                <p>Qualidade</p>
                <div className="speed-row">
                  {qualities.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={quality === item.id ? "active" : ""}
                      onClick={() => changeQuality(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p>Velocidade</p>
                <div className="speed-row">
                  {SPEEDS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={speed === value ? "active" : ""}
                      onClick={() => setSpeed(value)}
                    >
                      {value === 1 ? "Normal" : `${value}x`}
                    </button>
                  ))}
                </div>
                <button type="button" className={loop ? "active" : ""} onClick={() => setLoop((on) => !on)}>
                  <Repeat size={15} />
                  {loop ? "Repetir ligado" : "Repetir desligado"}
                </button>
                <button type="button" onClick={() => void pip()}>
                  <PictureInPicture2 size={15} />
                  Miniplayer
                </button>
              </div>
            ) : null}
          </div>
          <a className="ghost" href={downloadUrl(video)} aria-label="Baixar vídeo">
            <Download size={16} />
          </a>
          <button
            className="ghost"
            type="button"
            aria-label="Tela cheia"
            onClick={() => {
              const node = ref.current?.parentElement;
              if (!node) return;
              if (document.fullscreenElement) document.exitFullscreen();
              else node.requestFullscreen?.();
            }}
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
