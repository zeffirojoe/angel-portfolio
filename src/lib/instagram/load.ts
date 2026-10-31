import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, InstagramError, type ClientConfig } from "./client";
import { site } from "../site";
import type { Portfolio, UnavailableReason } from "./types";

const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** CDN URLs eventually stop working, so a last-good copy is only useful for so long. */
const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Keyed by source, so one account's or environment's posts can never appear for another. */
export function snapshotPathFor(config: ClientConfig | null) {
  const key = createHash("sha256")
    .update(`${config?.baseUrl ?? "meta"}|${config?.username ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(os.tmpdir(), `angel-portfolio-instagram-${key}.json`);
}

async function readSnapshot(file: string): Promise<Portfolio | null> {
  try {
    const p = JSON.parse(await fs.readFile(file, "utf8")) as Portfolio;
    if (!p.fetchedAt || Date.now() - Date.parse(p.fetchedAt) > MAX_STALE_MS) return null;
    return p;
  } catch {
    return null;
  }
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ClientConfig | null {
  if (!env.INSTAGRAM_ACCESS_TOKEN) return null;
  return {
    token: env.INSTAGRAM_ACCESS_TOKEN,
    username: env.INSTAGRAM_USERNAME || site.handle,
    userId: env.INSTAGRAM_USER_ID || undefined,
    version: env.INSTAGRAM_API_VERSION || undefined,
    baseUrl: env.INSTAGRAM_GRAPH_BASE_URL || undefined,
  };
}

/**
 * Fetches everything the token allows. Never throws: profile and posts decide
 * overall availability, while stories are a bonus because they need extra permissions.
 */
export async function loadPortfolio(
  config: ClientConfig | null = configFromEnv(),
  snapshotPath = snapshotPathFor(config),
): Promise<Portfolio> {
  const empty = (reason: UnavailableReason): Portfolio => ({
    status: "unavailable",
    reason,
    profile: null,
    media: [],
    stories: [],
    fetchedAt: null,
  });
  if (!config) return empty("not_configured");

  try {
    const client = createClient(config);
    const id = await client.resolveAccountId();
    const [profile, media, stories] = await Promise.all([
      client.getProfile(id),
      client.getMedia(id),
      client.getStories(id).catch((e) => {
        console.warn(`[instagram] stories skipped: ${e instanceof Error ? e.message : "unknown"}`);
        return [];
      }),
    ]);
    // A mistyped INSTAGRAM_USER_ID must not put someone else's work on this site.
    if (profile.username.toLowerCase() !== config.username.toLowerCase()) {
      throw new InstagramError("no_account");
    }
    const fresh: Portfolio = {
      status: "live",
      reason: null,
      profile,
      media,
      stories,
      fetchedAt: new Date().toISOString(),
    };
    await fs.writeFile(snapshotPath, JSON.stringify(fresh)).catch(() => {});
    return fresh;
  } catch (e) {
    const reason = e instanceof InstagramError ? e.reason : "api";
    console.error(`[instagram] ${e instanceof InstagramError ? e.message : "unexpected failure"}`);
    const snapshot = await readSnapshot(snapshotPath);
    if (!snapshot) return empty(reason);
    return {
      ...snapshot,
      status: "stale",
      reason,
      stories: snapshot.stories.filter(
        (s) => s.timestamp && Date.now() - Date.parse(s.timestamp) < STORY_LIFETIME_MS,
      ),
    };
  }
}
