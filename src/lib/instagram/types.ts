export type UnavailableReason =
  | "not_configured"
  | "auth" // expired or revoked token
  | "permission" // token is valid but lacks a permission
  | "no_account" // token works but has no Instagram account assigned
  | "rate_limit"
  | "network"
  | "api";

export type MediaAsset = {
  /** Image to display. For video, the thumbnail. Null if Meta withheld it. */
  imageUrl: string | null;
  /** Playable URL. Meta omits this for videos with licensed audio. */
  videoUrl: string | null;
};

export type PortfolioItem = {
  id: string;
  kind: "image" | "video" | "album";
  assets: MediaAsset[];
  caption: string;
  permalink: string | null;
  timestamp: string | null;
};

export type Profile = {
  username: string;
  name: string | null;
  biography: string | null;
  pictureUrl: string | null;
  followers: number | null;
  posts: number | null;
};

export type Portfolio = {
  /** live: fresh. stale: last good copy after a failed refresh. unavailable: nothing to show. */
  status: "live" | "stale" | "unavailable";
  reason: UnavailableReason | null;
  profile: Profile | null;
  media: PortfolioItem[];
  stories: PortfolioItem[];
  fetchedAt: string | null;
};
