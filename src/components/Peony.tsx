import type { CSSProperties } from "react";
import { foliage, petals } from "./peony-paths";

/** Peony in single-weight fine line. Decorative only. Blooms from the heart outward. */
export function Peony({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 520" fill="none" aria-hidden="true">
      <g className="peony-lines">
        <g style={{ "--delay": "0.1s" } as CSSProperties}>
          {foliage.map((d) => (
            <path key={d} pathLength={1} d={d} />
          ))}
        </g>
        {petals.map((ring, r) => (
          <g key={r} style={{ "--delay": `${(petals.length - r) * 0.22}s` } as CSSProperties}>
            {ring.map((d) => (
              <path className="peony-petal" key={d} pathLength={1} d={d} />
            ))}
          </g>
        ))}
      </g>
      <g className="peony-stars">
        <path d="M352 40 l3 13 13 3 -13 3 -3 13 -3 -13 -13 -3 13 -3z" />
        <path d="M34 52 l2 8 8 2 -8 2 -2 8 -2 -8 -8 -2 8 -2z" />
        <path d="M322 372 l2 8 8 2 -8 2 -2 8 -2 -8 -8 -2 8 -2z" />
      </g>
    </svg>
  );
}
