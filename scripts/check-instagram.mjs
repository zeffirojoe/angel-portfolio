#!/usr/bin/env node
// Reports what INSTAGRAM_ACCESS_TOKEN can do. Run: npm run ig:check
// Prints permissions, IDs and error codes, never the token.
const token = process.env.INSTAGRAM_ACCESS_TOKEN;
if (!token) {
  console.error("INSTAGRAM_ACCESS_TOKEN is not set.");
  process.exit(1);
}
const version = process.env.INSTAGRAM_API_VERSION || "v26.0";
const isIg = token.startsWith("IG");
const base = `https://graph.${isIg ? "instagram" : "facebook"}.com/${version}`;
const wanted = (process.env.INSTAGRAM_USERNAME ?? "").toLowerCase();

async function get(path, fields) {
  const url = new URL(`${base}/${path}`);
  if (fields) url.searchParams.set("fields", fields);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return res.json().catch(() => ({ error: { code: "invalid JSON" } }));
}
const outcome = (r, ok) => (r.error ? `BLOCKED (code ${r.error.code}${r.error.error_subcode ? `/${r.error.error_subcode}` : ""})` : ok(r));

console.log(`Token type: ${isIg ? "Instagram User" : "Facebook/system user"}; API ${version}`);
let id = process.env.INSTAGRAM_USER_ID || (isIg ? "me" : null);
if (!isIg) {
  const perms = await get("me/permissions");
  console.log("Permissions:", outcome(perms, (r) => r.data.filter((p) => p.status === "granted").map((p) => p.permission).join(", ")));
  if (!id) {
    const found = [];
    const a = await get("me/assigned_instagram_accounts", "id,username");
    found.push(...(a.data ?? []));
    for (const edge of ["me/accounts", "me/assigned_pages"]) {
      const p = await get(edge, "instagram_business_account{id,username}");
      found.push(...(p.data ?? []).map((x) => x.instagram_business_account).filter(Boolean));
    }
    console.log("Instagram accounts visible:", found.map((f) => `@${f.username ?? "?"} (${f.id})`).join(", ") || "NONE");
    id = found.find((f) => f.username?.toLowerCase() === wanted)?.id ?? null;
  }
}
if (!id) {
  console.log(`\nNo account found for @${wanted}. Set INSTAGRAM_USER_ID to the number shown under the account in the app's Instagram API setup page.`);
  process.exit(2);
}
const profile = await get(id, "username,name,biography,profile_picture_url,followers_count,media_count");
console.log("Profile:", outcome(profile, (r) => `OK @${r.username}, ${r.media_count} posts, picture ${r.profile_picture_url ? "yes" : "no"}`));
if (profile.username && profile.username.toLowerCase() !== wanted) console.log(`WARNING: this ID is @${profile.username}, not @${wanted}. The site will refuse to show it.`);
const media = await get(`${id}/media`, "id,media_type,media_url,thumbnail_url");
console.log("Posts:", outcome(media, (r) => `OK ${r.data.length} returned, ${r.data.filter((m) => !m.media_url).length} missing media_url`));
const stories = await get(`${id}/stories`, "id,media_type");
console.log("Stories:", outcome(stories, (r) => `OK ${r.data.length} active now`));
console.log("Messaging: not used. Meta only allows replies to people who messaged the account first.");
