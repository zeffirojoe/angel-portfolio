"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PortfolioItem } from "@/lib/instagram/types";

const PAGE = 12;

/** Next can only optimize allowlisted hosts; anything else loads as-is rather than failing. */
const optimizable = (url: string) => /^https:\/\/[^/]*\.(cdninstagram\.com|fbcdn\.net)\//.test(url);

/** Hashtag blocks read as noise on a portfolio; the post on Instagram keeps them. */
export function cleanCaption(caption: string) {
  return caption
    .replace(/(^|\s|(?<=[\p{L}\p{N}_]))[#@][\p{L}\p{N}_.]+/gu, "")
    .replace(/^[\s•·.\-_]+$/gmu, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function describe(item: PortfolioItem) {
  const text = cleanCaption(item.caption).split("\n")[0].slice(0, 120);
  if (text) return `Tattoo by Angel: ${text}`;
  return item.timestamp
    ? `Tattoo by Angel, posted ${new Date(item.timestamp).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`
    : "Tattoo by Angel";
}

function usePointerSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      start.current = e.touches.length === 1 ? e.touches[0].clientX : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (start.current === null) return;
      const dx = e.changedTouches[0].clientX - start.current;
      start.current = null;
      if (dx < -50) onLeft();
      else if (dx > 50) onRight();
    },
  };
}

export function Viewer({
  items,
  index,
  onIndex,
  onClose,
  label,
}: {
  items: PortfolioItem[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [asset, setAsset] = useState(0);
  const open = index !== null;
  const item = open ? items[index] : null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (index === null || !item) return;
      const next = asset + dir;
      if (next >= 0 && next < item.assets.length) {
        setAsset(next);
        return;
      }
      const target = (index + dir + items.length) % items.length;
      setAsset(dir === 1 ? 0 : items[target].assets.length - 1);
      onIndex(target);
    },
    [asset, index, item, items, onIndex],
  );

  const swipe = usePointerSwipe(
    () => go(1),
    () => go(-1),
  );

  const current = item?.assets[Math.min(asset, item.assets.length - 1)];
  const caption = item ? cleanCaption(item.caption) : "";
  const total = items.length > 1 || (item?.assets.length ?? 0) > 1;

  return (
    <dialog
      ref={ref}
      className="viewer"
      aria-label={label}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(1);
        if (e.key === "ArrowLeft") go(-1);
      }}
    >
      {item && current && (
        <div className="viewer-layout">
          <div className="viewer-stage" {...swipe}>
            {current.videoUrl ? (
              <video
                key={current.videoUrl}
                src={current.videoUrl}
                poster={current.imageUrl ?? undefined}
                controls
                playsInline
                preload="none"
              />
            ) : (
              <Image
                key={current.imageUrl}
                src={current.imageUrl!}
                alt={describe(item)}
                fill
                sizes="(min-width: 900px) 70vw, 100vw"
                quality={80}
                unoptimized={!optimizable(current.imageUrl!)}
              />
            )}
          </div>
          <div className="viewer-side">
            <p className="viewer-count" aria-live="polite">
              {(index ?? 0) + 1} of {items.length}
              {item.assets.length > 1 && ` · photo ${asset + 1} of ${item.assets.length}`}
            </p>
            {caption && <p className="viewer-caption">{caption}</p>}
            {item.permalink && (
              <a className="text-link" href={item.permalink} target="_blank" rel="noreferrer">
                View on Instagram
              </a>
            )}
            <a className="text-link" href="#book" onClick={onClose}>
              Request something similar
            </a>
          </div>
          <button type="button" className="viewer-btn viewer-close" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">×</span>
          </button>
          {total && (
            <>
              <button type="button" className="viewer-btn viewer-prev" onClick={() => go(-1)} aria-label="Previous">
                <span aria-hidden="true">←</span>
              </button>
              <button type="button" className="viewer-btn viewer-next" onClick={() => go(1)} aria-label="Next">
                <span aria-hidden="true">→</span>
              </button>
            </>
          )}
        </div>
      )}
    </dialog>
  );
}

function Thumb({ item, className, sizes, onOpen }: { item: PortfolioItem; className: string; sizes: string; onOpen: () => void }) {
  const src = item.assets[0].imageUrl;
  return (
    <button type="button" className={className} onClick={onOpen} aria-label={`View: ${describe(item)}`}>
      {src ? (
        <Image src={src} alt="" fill sizes={sizes} quality={70} unoptimized={!optimizable(src)} />
      ) : (
        <span className="thumb-noimage">Video</span>
      )}
      {item.kind !== "image" && (
        <span className="thumb-badge" aria-hidden="true">
          {item.kind === "video" ? "▶" : `1/${item.assets.length}`}
        </span>
      )}
    </button>
  );
}

export function Gallery({ items }: { items: PortfolioItem[] }) {
  const [shown, setShown] = useState(PAGE);
  const [index, setIndex] = useState<number | null>(null);
  const firstNew = useRef<HTMLLIElement>(null);
  const visible = items.slice(0, shown);

  return (
    <>
      <ul className="gallery">
        {visible.map((item, i) => (
          <li key={item.id} ref={i === shown - PAGE && i > 0 ? firstNew : undefined}>
            <Thumb
              item={item}
              className="thumb"
              sizes="(min-width: 1100px) 30vw, (min-width: 700px) 45vw, 50vw"
              onOpen={() => setIndex(i)}
            />
          </li>
        ))}
      </ul>
      {shown < items.length && (
        <button
          type="button"
          className="btn btn-outline gallery-more"
          onClick={() => {
            setShown((s) => s + PAGE);
            requestAnimationFrame(() => firstNew.current?.querySelector("button")?.focus({ preventScroll: true }));
          }}
        >
          Show more work
        </button>
      )}
      <Viewer items={items} index={index} onIndex={setIndex} onClose={() => setIndex(null)} label="Tattoo viewer" />
    </>
  );
}

export function Stories({ items }: { items: PortfolioItem[] }) {
  const [index, setIndex] = useState<number | null>(null);
  return (
    <div className="stories">
      <p className="eyebrow">Today</p>
      <ul>
        {items.map((item, i) => (
          <li key={item.id}>
            <Thumb item={item} className="story" sizes="72px" onOpen={() => setIndex(i)} />
          </li>
        ))}
      </ul>
      <Viewer items={items} index={index} onIndex={setIndex} onClose={() => setIndex(null)} label="Story viewer" />
    </div>
  );
}
