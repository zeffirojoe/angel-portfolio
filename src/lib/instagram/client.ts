import type { MediaAsset, PortfolioItem, Profile, UnavailableReason } from "./types";

/** Error safe to log: carries a classification and Meta's numeric codes, never the token. */
export class InstagramError extends Error {
  constructor(
    public reason: UnavailableReason,
    public code?: number,
    public subcode?: number,
  ) {
    super(`Instagram API: ${reason}${code ? ` (code ${code}${subcode ? `/${subcode}` : ""})` : ""}`);
    this.name = "InstagramError";
  }
}

type Fetch = typeof fetch;

export type ClientConfig = {
  token: string;
  username: string;
  userId?: string;
  version?: string;
  baseUrl?: string; // override for tests
  fetchImpl?: Fetch;
};

const PROFILE_FIELDS = "username,name,biography,profile_picture_url,followers_count,media_count";
const MEDIA_FIELDS =
  "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{id,media_type,media_url,thumbnail_url}";
const STORY_FIELDS = "id,media_type,media_url,thumbnail_url,permalink,timestamp";
const TIMEOUT_MS = 8000;

export function classifyGraphError(status: number, code?: number): UnavailableReason {
  if (code === 190 || status === 401) return "auth";
  if (code === 4 || code === 17 || code === 32 || code === 613 || status === 429) return "rate_limit";
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299) || status === 403) return "permission";
  // #100 / subcode 33: object missing or not visible to this token.
  if (code === 100) return "permission";
  return "api";
}

export function createClient(config: ClientConfig) {
  const f = config.fetchImpl ?? fetch;
  const version = config.version || "v26.0";
  // Instagram User tokens start with "IG" and only work against graph.instagram.com.
  const isInstagramToken = config.token.startsWith("IG");
  const base =
    config.baseUrl?.replace(/\/$/, "") ??
    `https://graph.${isInstagramToken ? "instagram" : "facebook"}.com/${version}`;

  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${base}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res: Response;
    try {
      // The token goes in a header so it can't leak through URL logs.
      res = await f(url, {
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new InstagramError("network");
    }
    const body = (await res.json().catch(() => null)) as
      | (T & { error?: { code?: number; error_subcode?: number } })
      | null;
    if (!res.ok || !body || body.error) {
      const code = body?.error?.code;
      throw new InstagramError(classifyGraphError(res.status, code), code, body?.error?.error_subcode);
    }
    return body;
  }

  type Row = { id?: string; username?: string; instagram_business_account?: { id: string; username?: string } };

  /** Finds the professional account ID the token may read. */
  async function resolveAccountId(): Promise<string> {
    if (config.userId) return config.userId;
    if (isInstagramToken) return "me";

    const candidates: { id: string; username?: string }[] = [];
    const collect = async (path: string, fields: string, pick: (r: Row) => { id: string; username?: string } | null) => {
      try {
        const { data } = await get<{ data: Row[] }>(path, { fields });
        for (const row of data ?? []) {
          const c = pick(row);
          if (c) candidates.push(c);
        }
      } catch (e) {
        // Edges vary by token type; a missing edge only means "keep looking". Auth failures are final.
        if (e instanceof InstagramError && (e.reason === "auth" || e.reason === "network" || e.reason === "rate_limit")) throw e;
      }
    };
    await collect("me/assigned_instagram_accounts", "id,username", (r) => (r.id ? { id: r.id, username: r.username } : null));
    await collect("me/accounts", "instagram_business_account{id,username}", (r) => r.instagram_business_account ?? null);
    await collect("me/assigned_pages", "instagram_business_account{id,username}", (r) => r.instagram_business_account ?? null);

    const wanted = config.username.toLowerCase();
    const match = candidates.find((c) => c.username?.toLowerCase() === wanted);
    // Only a single unnamed candidate is safe to assume; never show a different account's work.
    const chosen = match ?? (candidates.length === 1 && !candidates[0].username ? candidates[0] : null);
    if (!chosen) throw new InstagramError("no_account");
    return chosen.id;
  }

  return {
    resolveAccountId,

    async getProfile(id: string): Promise<Profile> {
      const r = await get<{
        username?: string;
        name?: string;
        biography?: string;
        profile_picture_url?: string;
        followers_count?: number;
        media_count?: number;
      }>(id, { fields: PROFILE_FIELDS });
      return {
        username: r.username ?? config.username,
        name: r.name ?? null,
        biography: r.biography ?? null,
        pictureUrl: r.profile_picture_url ?? null,
        followers: r.followers_count ?? null,
        posts: r.media_count ?? null,
      };
    },

    async getMedia(id: string, limit = 24): Promise<PortfolioItem[]> {
      const r = await get<{ data: RawMedia[] }>(`${id}/media`, { fields: MEDIA_FIELDS, limit: String(limit) });
      return (r.data ?? []).map(normalizeMedia).filter((m): m is PortfolioItem => m !== null);
    },

    async getStories(id: string): Promise<PortfolioItem[]> {
      const r = await get<{ data: RawMedia[] }>(`${id}/stories`, { fields: STORY_FIELDS });
      return (r.data ?? []).map(normalizeMedia).filter((m): m is PortfolioItem => m !== null);
    },
  };
}

type RawMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  children?: { data?: RawMedia[] };
};

function toAsset(m: RawMedia): MediaAsset {
  const isVideo = m.media_type === "VIDEO";
  return {
    imageUrl: isVideo ? (m.thumbnail_url ?? null) : (m.media_url ?? null),
    videoUrl: isVideo ? (m.media_url ?? null) : null,
  };
}

/** Meta treats media_url as optional; items with nothing displayable are dropped. */
export function normalizeMedia(m: RawMedia): PortfolioItem | null {
  const album = m.media_type === "CAROUSEL_ALBUM";
  const children = album ? (m.children?.data ?? []).map(toAsset) : [];
  const assets = (album ? (children.length ? children : [toAsset(m)]) : [toAsset(m)]).filter(
    (a) => a.imageUrl || a.videoUrl,
  );
  if (assets.length === 0) return null;
  return {
    id: m.id,
    kind: album ? "album" : m.media_type === "VIDEO" ? "video" : "image",
    assets,
    caption: m.caption ?? "",
    permalink: m.permalink ?? null,
    timestamp: m.timestamp ?? null,
  };
}
