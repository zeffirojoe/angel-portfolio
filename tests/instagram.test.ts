import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { classifyGraphError, createClient, normalizeMedia } from "@/lib/instagram/client";
import { configFromEnv, loadPortfolio, snapshotPathFor } from "@/lib/instagram/load";

const TOKEN = "EAG-secret-token-value";
const tmp = () => path.join(mkdtempSync(path.join(os.tmpdir(), "ig-")), "snap.json");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function graph(routes: Record<string, unknown>) {
  return vi.fn(async (url: URL | RequestInfo) => {
    const key = new URL(String(url)).pathname.replace(/^\/v\d+\.\d+\//, "").replace(/^\//, "");
    const hit = routes[key];
    if (hit === undefined) return json({ error: { code: 100 } }, 400);
    if (hit instanceof Error) throw hit;
    return hit instanceof Response ? hit.clone() : json(hit);
  }) as unknown as typeof fetch;
}

const happy = {
  "me/assigned_instagram_accounts": { data: [{ id: "178", username: "tattooist_angel" }] },
  "178": { username: "tattooist_angel", name: "Angel", followers_count: 805, media_count: 84 },
  "178/media": { data: [{ id: "1", media_type: "IMAGE", media_url: "https://x.cdninstagram.com/1.jpg", caption: "Rose", permalink: "https://instagram.com/p/1" }] },
  "178/stories": { data: [] },
};

describe("error classification", () => {
  it.each([
    [400, 190, "auth"],
    [400, 4, "rate_limit"],
    [403, 10, "permission"],
    [400, 200, "permission"],
    [400, 100, "permission"],
    [500, 1, "api"],
  ])("HTTP %i code %i is %s", (status, code, want) => {
    expect(classifyGraphError(status, code)).toBe(want);
  });
});

describe("media normalization", () => {
  it("uses the thumbnail when Meta omits a video's media_url", () => {
    const m = normalizeMedia({ id: "v", media_type: "VIDEO", thumbnail_url: "t.jpg" })!;
    expect(m.assets[0]).toEqual({ imageUrl: "t.jpg", videoUrl: null });
  });
  it("drops items with nothing to display", () => {
    expect(normalizeMedia({ id: "v", media_type: "VIDEO" })).toBeNull();
  });
  it("expands album children", () => {
    const m = normalizeMedia({
      id: "a",
      media_type: "CAROUSEL_ALBUM",
      children: { data: [{ id: "1", media_type: "IMAGE", media_url: "a.jpg" }, { id: "2", media_type: "VIDEO", media_url: "b.mp4", thumbnail_url: "b.jpg" }] },
    })!;
    expect(m.kind).toBe("album");
    expect(m.assets).toEqual([{ imageUrl: "a.jpg", videoUrl: null }, { imageUrl: "b.jpg", videoUrl: "b.mp4" }]);
  });
});

describe("request handling", () => {
  it("sends the token only in the Authorization header", async () => {
    const fetchImpl = graph(happy);
    await createClient({ token: TOKEN, username: "tattooist_angel", userId: "178", fetchImpl }).getProfile("178");
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(String(url)).not.toContain(TOKEN);
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });
  it("routes Instagram User tokens to graph.instagram.com", async () => {
    const fetchImpl = vi.fn(async () => json({ username: "a" })) as unknown as typeof fetch;
    await createClient({ token: "IGAA123", username: "a", fetchImpl }).getProfile("me");
    expect(String(vi.mocked(fetchImpl).mock.calls[0][0])).toContain("https://graph.instagram.com/");
  });
  it("refuses to show an account other than the configured one", async () => {
    const fetchImpl = graph({ "me/assigned_instagram_accounts": { data: [{ id: "9", username: "someone_else" }] }, "me/accounts": { data: [] }, "me/assigned_pages": { data: [] } });
    const p = await loadPortfolio({ token: TOKEN, username: "tattooist_angel", fetchImpl }, tmp());
    expect(p).toMatchObject({ status: "unavailable", reason: "no_account" });
  });
});

describe("snapshot isolation", () => {
  it("uses separate snapshots for different sources and accounts", () => {
    const a = snapshotPathFor({ token: "t", username: "tattooist_angel" });
    expect(snapshotPathFor({ token: "t2", username: "tattooist_angel" })).toBe(a);
    expect(snapshotPathFor({ token: "t", username: "other" })).not.toBe(a);
    expect(snapshotPathFor({ token: "t", username: "tattooist_angel", baseUrl: "http://localhost:4010" })).not.toBe(a);
  });
});

describe("loadPortfolio", () => {
  const cfg = (routes: Record<string, unknown>) => ({ token: TOKEN, username: "tattooist_angel", fetchImpl: graph(routes) });

  it("loads live data via account discovery", async () => {
    const p = await loadPortfolio(cfg(happy), tmp());
    expect(p.status).toBe("live");
    expect(p.profile?.followers).toBe(805);
    expect(p.media).toHaveLength(1);
  });
  it("still succeeds when stories are not permitted", async () => {
    const { "178/stories": _omit, ...rest } = happy;
    void _omit;
    const p = await loadPortfolio(cfg(rest), tmp());
    expect(p.status).toBe("live");
    expect(p.stories).toEqual([]);
  });
  it("refuses a user ID that belongs to another account", async () => {
    const p = await loadPortfolio({ ...cfg(happy), username: "someone_else", userId: "178" }, tmp());
    expect(p).toMatchObject({ status: "unavailable", reason: "no_account", media: [] });
  });
  it("reads the configured environment variables", () => {
    const c = configFromEnv({ INSTAGRAM_ACCESS_TOKEN: "t", INSTAGRAM_USERNAME: "u", INSTAGRAM_USER_ID: "1" } as unknown as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ token: "t", username: "u", userId: "1" });
    expect(configFromEnv({} as unknown as NodeJS.ProcessEnv)).toBeNull();
  });
  it("reports a missing token without calling Meta", async () => {
    expect((await loadPortfolio(null, tmp())).reason).toBe("not_configured");
  });
  it("reports an expired token", async () => {
    const expired = json({ error: { code: 190 } }, 400);
    const p = await loadPortfolio(cfg({ "me/assigned_instagram_accounts": expired }), tmp());
    expect(p).toMatchObject({ status: "unavailable", reason: "auth" });
  });
  it("reports network failures", async () => {
    const p = await loadPortfolio(cfg({ "me/assigned_instagram_accounts": new Error("down") }), tmp());
    expect(p.reason).toBe("network");
  });
  it("serves the last good copy after a failure", async () => {
    const snap = tmp();
    await loadPortfolio(cfg(happy), snap);
    const p = await loadPortfolio(cfg({ "me/assigned_instagram_accounts": json({ error: { code: 190 } }, 400) }), snap);
    expect(p.status).toBe("stale");
    expect(p.reason).toBe("auth");
    expect(p.media).toHaveLength(1);
  });
  it("ignores a last good copy older than a week", async () => {
    const snap = tmp();
    writeFileSync(snap, JSON.stringify({ status: "live", media: [{}], stories: [], fetchedAt: new Date(Date.now() - 8 * 864e5).toISOString() }));
    const p = await loadPortfolio(cfg({ "me/assigned_instagram_accounts": new Error("down") }), snap);
    expect(p.status).toBe("unavailable");
  });
  it("drops expired stories from a stale copy", async () => {
    const snap = tmp();
    writeFileSync(snap, JSON.stringify({ status: "live", media: [], fetchedAt: new Date().toISOString(), stories: [{ id: "s", timestamp: new Date(Date.now() - 25 * 36e5).toISOString() }] }));
    const p = await loadPortfolio(cfg({ "me/assigned_instagram_accounts": new Error("down") }), snap);
    expect(p.stories).toEqual([]);
  });
  it("never logs the token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadPortfolio(cfg({ "me/assigned_instagram_accounts": json({ error: { code: 190, message: TOKEN } }, 400) }), tmp());
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    spy.mockRestore();
  });
});
