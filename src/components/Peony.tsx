import type { CSSProperties } from "react";
import { leaves, petals } from "./peony-paths";

type Shape = (typeof petals)[number];

function Layer({ shape, delay }: { shape: Shape; delay: number }) {
  return (
    <g style={{ "--delay": `${delay.toFixed(2)}s` } as CSSProperties}>
      <path className="peony-shape" pathLength={1} d={shape.outline} />
      {shape.lines.map((d) => (
        <path className="peony-detail" key={d} pathLength={1} d={d} />
      ))}
    </g>
  );
}

/** Fine line peony traced from the artist's reference drawing. Decorative only. */
export function Peony({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 600" fill="none" aria-hidden="true">
      <g className="peony-lines">
        {leaves.map((shape, i) => (
          <Layer key={shape.outline} shape={shape} delay={0.9 + i * 0.08} />
        ))}
        {/* Listed back to front; drawn in reverse so the bloom opens from its heart. */}
        {petals.map((shape, i) => (
          <Layer key={shape.outline} shape={shape} delay={(petals.length - i) * 0.05} />
        ))}
      </g>
    </svg>
  );
}
