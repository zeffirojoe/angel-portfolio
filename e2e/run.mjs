#!/usr/bin/env node
// End-to-end check against a production build, using a fake Graph API and a local SMTP server.
//   npm run e2e           mock Instagram: full gallery and booking flow
//   npm run e2e -- real   whatever .env really provides: degraded states with no fakes
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import http from "node:http";
import { simpleParser } from "mailparser";
import { chromium } from "playwright";
import sharp from "sharp";
import { SMTPServer } from "smtp-server";

const REAL = process.argv[2] === "real";
const PORT = 3100, GRAPH = 4010, SMTP = 2525;
const URL_ = `http://localhost:${PORT}`;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

// A distinct, tattoo-like line drawing per post, for judging layout with real-feeling images.
const art = async (n, w = 1080, h = 1350) => {
  const r = 150 + (n * 37) % 200;
  const petals = Array.from({ length: 6 + n % 5 }, (_, i) => `<ellipse cx="${w / 2}" cy="${h / 2 - r / 1.4}" rx="${r / 3.5}" ry="${r / 1.5}" fill="none" stroke="#222" stroke-width="3" transform="rotate(${(i * 360) / (6 + n % 5)} ${w / 2} ${h / 2})"/>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#${["d9cfc6", "e4dcd5", "cfc4ba", "ded3cc"][n % 4]}"/>${petals}</svg>`)).jpeg({ quality: 80 }).toBuffer();
};

function graphServer() {
  const img = (n) => `http://localhost:${GRAPH}/img/${n}.jpg`;
  const media = Array.from({ length: 16 }, (_, i) => {
    const n = i + 1;
    const base = { id: `m${n}`, permalink: `https://www.instagram.com/p/mock${n}/`, timestamp: "2026-09-01T12:00:00+0000", caption: `Peony study ${n}, soft black and grey on the forearm.\n\n#fineline #njtattoo` };
    if (n === 2) return { ...base, media_type: "CAROUSEL_ALBUM", media_url: img(n), children: { data: [{ id: "c1", media_type: "IMAGE", media_url: img(20) }, { id: "c2", media_type: "IMAGE", media_url: img(21) }, { id: "c3", media_type: "IMAGE", media_url: img(22) }] } };
    if (n === 3) return { ...base, media_type: "VIDEO", thumbnail_url: img(n) }; // licensed audio: media_url withheld
    return { ...base, media_type: "IMAGE", media_url: img(n) };
  });
  return http.createServer(async (req, res) => {
    const path = new URL(req.url, "http://x").pathname.replace(/^\/+/, "");
    const send = (b) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(b)); };
    if (path.startsWith("img/")) { res.setHeader("content-type", "image/jpeg"); return res.end(await art(parseInt(path.slice(4)))); }
    if (path === "me/assigned_instagram_accounts") return send({ data: [{ id: "178", username: "tattooist_angel" }] });
    if (path === "me/accounts" || path === "me/assigned_pages") return send({ data: [] });
    if (path === "178") return send({ username: "tattooist_angel", name: "Angel", biography: "Fine line", profile_picture_url: img(30), followers_count: 805, media_count: 84 });
    if (path === "178/media") return send({ data: media });
    if (path === "178/stories") return send({ data: [{ id: "s1", media_type: "IMAGE", media_url: img(31), timestamp: new Date().toISOString() }] });
    res.statusCode = 400; send({ error: { code: 100 } });
  });
}

const mail = [];
let smtp;
function startSmtp() {
  smtp = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData: (s, _x, cb) => simpleParser(s).then((m) => { mail.push(m); cb(); }) });
  return new Promise((r) => smtp.listen(SMTP, "127.0.0.1", r));
}

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
delete env.NODE_ENV;
const mockEnv = { INSTAGRAM_ACCESS_TOKEN: "EAG-e2e-fake", INSTAGRAM_USER_ID: "", INSTAGRAM_USERNAME: "tattooist_angel", INSTAGRAM_GRAPH_BASE_URL: `http://localhost:${GRAPH}`, SMTP_HOST: "127.0.0.1", SMTP_PORT: String(SMTP), SMTP_FROM: "site@example.com", EMAIL: "artist@example.com", SMTP_USER: "", SMTP_PASSWORD: "" };
if (!REAL) Object.assign(env, mockEnv);
// Never email the artist from a test run, even with real settings in .env.
else env.SMTP_HOST = "";

// A leftover server would answer instead of this build and make results meaningless.
if (await fetch(URL_).then(() => true, () => false)) {
  console.error(`Port ${PORT} is already in use. Stop that server and retry.`);
  process.exit(1);
}

let graph;
if (!REAL) { graph = graphServer(); await new Promise((r) => graph.listen(GRAPH, r)); await startSmtp(); }

console.log(`Building (${REAL ? "real .env" : "mock"})...`);
// Must stay asynchronous: the fake Graph API lives in this process and serves the prerender.
const build = await new Promise((resolve) => {
  const child = spawn("npx", ["next", "build"], { env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  child.on("close", (status) => resolve({ status, stderr }));
});
check("production build", build.status === 0, build.status ? build.stderr.slice(-400) : "");
if (build.status) process.exit(1);

const app = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let serverLog = "";
app.stdout.on("data", (d) => (serverLog += d));
app.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60; i++) { try { await fetch(URL_); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }

const browser = await chromium.launch();
const VIEWPORTS = [["phone", { width: 390, height: 844 }, true], ["tablet", { width: 820, height: 1180 }, true], ["desktop", { width: 1440, height: 900 }, false]];

async function fill(page) {
  await page.fill("#name", "Jamie Rivera");
  await page.fill("#instagram", "@jamie.r");
  await page.fill("#email", "jamie@example.com");
  await page.fill("#confirmEmail", "jamie@example.com");
  await page.fill("#phone", "(732) 555-0123");
  // Real taps on the visible chips, so anything covering them makes this fail.
  await page.locator("label.chip", { hasText: /^No$/ }).click();
  await page.locator("label.chip", { hasText: "New tattoo" }).click();
  await page.locator("label.chip", { hasText: /^Fine line$/ }).click();
  await page.fill("#description", "A small peony with a soft shaded stem, for my grandmother.");
  await page.fill("#placement", "Inner left forearm");
  await page.selectOption("#size", "Small (2 to 4 in)");
  await page.selectOption("#budget", "$200 to $500");
  await page.fill("#availability", "Weekday afternoons");
  await page.check("input[name=adult]");
  await page.check("input[name=understood]");
  check("chips register taps", await page.isChecked('input[name=style][value="Fine line"]'));
}

try {
  for (const [name, viewport, touch] of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1, bypassCSP: !REAL });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !/instagram|graphql|ERR_BLOCKED/i.test(m.location().url + m.text())) errors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(URL_, { waitUntil: "load" });
    await page.waitForTimeout(3200);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${name}: no horizontal scroll`, (await overflow()) <= 0, `${await overflow()}px`);
    await page.screenshot({ path: `${out}${REAL ? "real-" : ""}${name}-hero.png` });
    await page.locator("#work").scrollIntoViewIfNeeded();
    await page.waitForTimeout(REAL ? 3500 : 800);
    await page.screenshot({ path: `${out}${REAL ? "real-" : ""}${name}-work.png` });
    await page.locator("#book").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}${REAL ? "real-" : ""}${name}-book.png` });

    const small = await page.$$eval("a[href],button,input:not([type=file]):not([type=radio]):not([type=checkbox]),select", (els) => els.filter((e) => e.offsetParent && !e.closest(".hp") && e.getBoundingClientRect().height < 24 && !e.closest("p,footer,.viewer-side")).map((e) => e.outerHTML.slice(0, 80)));
    check(`${name}: controls are tall enough to tap`, small.length === 0, small.slice(0, 2).join(" "));
    check(`${name}: no console errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, bypassCSP: !REAL });
  const page = await ctx.newPage();
  await page.goto(URL_);

  if (!REAL) {
    await page.waitForSelector('[data-portfolio-status="live"]');
    check("gallery renders live data", true);
    check("first page of 12 thumbnails", (await page.locator(".gallery .thumb").count()) === 12);
    check("stories shown when permitted", (await page.locator(".story").count()) === 1);
    check("profile stats shown", (await page.locator(".artist-meta").innerText()).includes("805 followers"));
    await page.click(".gallery-more");
    check("show more reveals the rest", (await page.locator(".gallery .thumb").count()) === 16);

    await page.locator(".gallery .thumb").nth(1).click();
    const dialog = page.locator("dialog.viewer[open]");
    await dialog.waitFor();
    check("viewer shows album position", (await dialog.locator(".viewer-count").innerText()).includes("photo 1 of 3"));
    check("viewer strips hashtags", !(await dialog.locator(".viewer-caption").innerText()).includes("#fineline"));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}phone-viewer.png` });
    await page.keyboard.press("ArrowRight");
    check("arrow key advances in album", (await dialog.locator(".viewer-count").innerText()).includes("photo 2 of 3"));
    await page.click(".viewer-next"); await page.click(".viewer-next");
    check("next moves to the following post", (await dialog.locator(".viewer-count").innerText()).startsWith("3 of"));
    check("video without media_url falls back to thumbnail", (await dialog.locator(".viewer-stage img").count()) === 1);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("dialog.viewer[open]"));
    check("escape closes viewer", true);
    check("focus returns to the thumbnail", await page.evaluate(() => document.activeElement?.classList.contains("thumb")));
  }

  // Validation
  await page.locator("#book").scrollIntoViewIfNeeded();
  await page.click(".btn-submit");
  await page.waitForTimeout(150);
  check("empty submit shows field errors", (await page.locator(".field-error").count()) >= 8);
  check("focus moves to the first invalid field", (await page.evaluate(() => document.activeElement?.id)) === "name");
  check("invalid field is announced", (await page.getAttribute("#name", "aria-invalid")) === "true");
  await page.screenshot({ path: `${out}phone-errors.png`, fullPage: false });

  await fill(page);
  await page.fill("#confirmEmail", "typo@example.com");
  await page.click(".btn-submit");
  check("mismatched email caught", (await page.locator("#confirmEmail-error").innerText()).includes("match"));
  await page.fill("#confirmEmail", "jamie@example.com");

  // Both confirmations are required: neither alone may reach the server.
  let posts = 0;
  const countPost = (r) => { if (r.url().endsWith("/api/inquiry")) posts++; };
  page.on("request", countPost);
  for (const name of ["adult", "understood"]) {
    await page.uncheck(`input[name=${name}]`);
    await page.click(".btn-submit");
    check(`submit blocked without "${name}"`, (await page.locator(`#${name}-error`).count()) === 1 && (await page.locator(".form-success").count()) === 0);
    check(`"${name}" error focuses the checkbox`, (await page.evaluate(() => document.activeElement?.getAttribute("name"))) === name);
    await page.check(`input[name=${name}]`);
  }
  page.off("request", countPost);
  check("blocked submits never reached the server", posts === 0);
  check("age wording mentions a guardian", (await page.locator("label.check").first().innerText()).includes("guardian who is 18 or older"));

  // Upload: a large phone-sized photo gets shrunk in the browser.
  const photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).jpeg({ quality: 95 }).toBuffer();
  await page.setInputFiles("#referenceImages", [{ name: "phone.jpg", mimeType: "image/jpeg", buffer: photo }]);
  await page.waitForSelector(".previews img");
  check("upload preview appears", true, `original ${(photo.length / 1e6).toFixed(1)} MB`);
  await page.setInputFiles("#placementPhotos", [{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }]);
  await page.waitForSelector("#placementPhotos-error");
  check("non-image upload refused", true);

  if (!REAL) {
    // Failure first: the visitor must not see success when the mail server is down.
    await new Promise((r) => smtp.close(r));
    await page.click(".btn-submit");
    await page.waitForSelector(".form-error");
    check("mail outage shows failure, not success", (await page.locator(".form-success").count()) === 0);
    check("entries preserved after failure", (await page.inputValue("#description")).includes("peony"));
    await page.screenshot({ path: `${out}phone-failure.png` });

    await startSmtp();
    await page.click(".btn-submit");
    await page.waitForSelector(".form-success");
    check("success after the mail server accepts", mail.length === 1);
    const m = mail[0];
    check("email goes to the artist, reply-to client", m.to.text === "artist@example.com" && m.replyTo.text.includes("jamie@example.com"));
    check("reference image attached and small", m.attachments.length === 1 && m.attachments[0].size < 1_000_000, m.attachments[0] && `${(m.attachments[0].size / 1e3).toFixed(0)} KB`);
    check("success says not confirmed", (await page.locator(".form-success").innerText()).includes("confirmed appointment"));
    const dm = page.locator(".dm-note a");
    check("DM button targets Angel's account", (await dm.getAttribute("href")) === "https://ig.me/m/tattooist_angel");
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    await ctx.route("https://ig.me/**", (r) => r.fulfill({ status: 200, body: "ok" }));
    const [popup] = await Promise.all([ctx.waitForEvent("page"), dm.click()]);
    await popup.close();
    await page.waitForFunction(() => document.querySelector(".dm-note")?.innerText.includes("Copied"));
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check("DM note copied with name and email", clip.includes("Jamie Rivera") && clip.includes("jamie@example.com"), clip.slice(0, 60));
    await page.locator(".form-success").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}phone-success.png` });
  } else {
    await page.click(".btn-submit");
    await page.waitForSelector(".form-error");
    check("no delivery credentials: failure shown, not success", (await page.locator(".form-success").count()) === 0, (await page.locator(".form-error").innerText()).slice(0, 80));
    const status = await page.getAttribute("[data-portfolio-status]", "data-portfolio-status");
    if (status === "fallback") {
      console.log("NOTE  Instagram API not available: checking the public embed fallback");
      await page.locator(".embeds").scrollIntoViewIfNeeded();
      await page.waitForTimeout(4000);
      const frame = page.frames().find((f) => /instagram\.com\/p\/.*embed/.test(f.url()));
      check("public Instagram embed loads under the CSP", !!frame && (await frame.locator("img").count().catch(() => 0)) > 0);
    } else {
      check("real Instagram posts render", status === "live", status);
      const first = page.locator(".gallery .thumb img").first();
      await first.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => { const i = document.querySelector(".gallery .thumb img"); return i?.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
      check("real image loads through the optimizer under the CSP", (await first.getAttribute("src")).startsWith("/_next/image"));
      const pic = await page.evaluate(() => { const i = document.querySelector(".artist-photo img"); return !!i; });
      check("real profile picture present", pic);
      check("real bio shown", (await page.locator(".artist-bio").innerText()).includes("East Brunswick"));
      await page.locator(".gallery .thumb").first().click();
      await page.locator("dialog.viewer[open]").waitFor();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}real-phone-viewer.png` });
      const cap = await page.locator(".viewer-caption").innerText().catch(() => "");
      check("real captions cleaned", !/[#•]/.test(cap), cap.slice(0, 80));
      await page.keyboard.press("Escape");
    }
  }

  // Reduced motion
  const rm = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, bypassCSP: !REAL });
  const rp = await rm.newPage();
  await rp.goto(URL_);
  await rp.waitForTimeout(200);
  const motion = await rp.evaluate(() => ({ offset: getComputedStyle(document.querySelector(".peony-lines path")).strokeDashoffset, opacity: getComputedStyle(document.querySelector(".hero-copy .hero-in")).opacity }));
  check("reduced motion: content visible immediately", parseFloat(motion.offset) === 0 && motion.opacity === "1", JSON.stringify(motion));
  await rm.close();

  // Secrets
  const scan = spawnSync("bash", ["-c", `set -a; . ./.env; set +a; for v in "$INSTAGRAM_ACCESS_TOKEN" "$EMAIL" "$SMTP_PASSWORD"; do [ -n "$v" ] && grep -rlF -- "$v" .next/static; done; true`], { encoding: "utf8" });
  check("no secrets or the artist's email in client bundles", scan.stdout.trim() === "", scan.stdout.trim());
  const html = await (await fetch(URL_)).text();
  const secrets = spawnSync("bash", ["-c", `set -a; . ./.env; set +a; printf '%s\\n%s' "$INSTAGRAM_ACCESS_TOKEN" "$EMAIL"`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  check("no secrets in served HTML", !secrets.some((s) => html.includes(s)));
  check("no secrets in server logs", !secrets.some((s) => serverLog.includes(s)));
} finally {
  await browser.close();
  try { process.kill(-app.pid); } catch {}
  graph?.close();
  smtp?.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
