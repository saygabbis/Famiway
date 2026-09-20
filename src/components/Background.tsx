import { useEffect, useRef } from "react";

type Props = {
  view: string;
};

type Cloud = {
  homeX: number;
  homeY: number;
  ampX: number;
  ampY: number;
  speed: number;
  ratio: number;
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
};

const RECIPE: Omit<Cloud, "x" | "y" | "vx" | "vy" | "phase">[] = [
  { homeX: 0.14, homeY: 0.2, ampX: 140, ampY: 110, speed: 0.00022, ratio: 0.7, size: 720 },
  { homeX: 0.86, homeY: 0.24, ampX: 160, ampY: 120, speed: 0.00018, ratio: 1.2, size: 680 },
  { homeX: 0.22, homeY: 0.82, ampX: 130, ampY: 150, speed: 0.0002, ratio: 0.9, size: 640 },
  { homeX: 0.8, homeY: 0.78, ampX: 150, ampY: 110, speed: 0.00024, ratio: 1.08, size: 700 },
  { homeX: 0.52, homeY: 0.08, ampX: 180, ampY: 70, speed: 0.00016, ratio: 0.62, size: 560 },
];

export default function Background({ view }: Props) {
  const layer = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: -9999, y: -9999, on: false });
  const nudge = useRef(0);

  useEffect(() => {
    nudge.current = 0.8;
  }, [view]);

  useEffect(() => {
    const host = layer.current;
    if (!host) return;

    const clouds: Cloud[] = RECIPE.map((item, index) => ({
      ...item,
      x: window.innerWidth * item.homeX,
      y: window.innerHeight * item.homeY,
      vx: 0,
      vy: 0,
      phase: index * 2.1,
    }));

    const nodes = clouds.map((_, index) => host.querySelector<HTMLElement>(`.bg-blob-${index}`));

    const onMove = (event: PointerEvent) => {
      mouse.current = { x: event.clientX, y: event.clientY, on: true };
    };
    const onLeave = () => {
      mouse.current.on = false;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);

    let frame = 0;
    let running = true;
    const tick = () => {
      if (!running) return;
      if (document.hidden) {
        frame = 0;
        return;
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      const pointer = mouse.current;
      if (nudge.current > 0.01) nudge.current *= 0.96;
      else nudge.current = 0;

      clouds.forEach((cloud, index) => {
        cloud.phase += cloud.speed * 16;
        const wanderX = w * cloud.homeX + Math.sin(cloud.phase) * cloud.ampX;
        const wanderY = h * cloud.homeY + Math.cos(cloud.phase * cloud.ratio) * cloud.ampY;

        cloud.vx += (wanderX - cloud.x) * 0.01;
        cloud.vy += (wanderY - cloud.y) * 0.01;

        if (pointer.on) {
          const dx = cloud.x - pointer.x;
          const dy = cloud.y - pointer.y;
          const dist = Math.hypot(dx, dy) || 1;
          const radius = Math.max(cloud.size * 0.55, 260);
          if (dist < radius) {
            const falloff = (1 - dist / radius) ** 3;
            const force = falloff * 0.55;
            cloud.vx += (dx / dist) * force;
            cloud.vy += (dy / dist) * force;
          }
        }

        if (nudge.current) {
          cloud.vx += Math.sin(cloud.phase + index) * nudge.current * 0.12;
          cloud.vy += Math.cos(cloud.phase + index) * nudge.current * 0.12;
        }

        cloud.vx *= 0.9;
        cloud.vy *= 0.9;
        cloud.x += cloud.vx;
        cloud.y += cloud.vy;

        const node = nodes[index];
        if (node) {
          node.style.transform = `translate3d(${cloud.x - cloud.size / 2}px, ${cloud.y - cloud.size / 2}px, 0)`;
        }
      });

      frame = window.requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      if (!document.hidden && running && !frame) frame = window.requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", onVisibility);
    frame = window.requestAnimationFrame(tick);

    return () => {
      running = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className={`bg bg-${view}`} aria-hidden="true">
      <div className="bg-grid" />
      <div ref={layer} className="bg-blobs">
        {RECIPE.map((_, index) => (
          <div key={index} className={`bg-blob bg-blob-${index}`} />
        ))}
      </div>
    </div>
  );
}
