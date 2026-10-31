import sharp from "sharp";
import { simpleParser, type ParsedMail } from "mailparser";
import { SMTPServer } from "smtp-server";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/inquiry/route";
import { resetRateLimit } from "@/lib/inquiry/spam";

const received: ParsedMail[] = [];
let rejectAll = false;
let server: SMTPServer;

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onRcptTo(_addr, _session, cb) {
      cb(rejectAll ? new Error("550 mailbox unavailable") : undefined);
    },
    onData(stream, _session, cb) {
      simpleParser(stream).then((m) => {
        received.push(m);
        cb();
      });
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.server.address() as AddressInfo;
  Object.assign(process.env, {
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(port),
    SMTP_FROM: "site@example.com",
    EMAIL: "artist@example.com",
    SMTP_INSECURE_FOR_TESTS: "1",
  });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  resetRateLimit();
  received.length = 0;
  rejectAll = false;
});

const valid: Record<string, string> = {
  name: "Jamie Rivera",
  email: "Jamie@Example.com",
  confirmEmail: "jamie@example.com",
  phone: "(732) 555-0123",
  instagram: "@jamie.r",
  projectType: "New tattoo",
  style: "Fine line",
  description: "A small peony with soft black and grey shading on the stem.",
  placement: "Inner left forearm",
  size: "Small (2 to 4 in)",
  earliestDate: "",
  availability: "Weekday afternoons",
  budget: "$200 to $500",
  returning: "No",
  notes: "",
  adult: "on",
  understood: "on",
  website: "",
};

const image = () =>
  sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#222" } })
    .withExif({ IFD0: { Copyright: "SECRET-EXIF-MARKER" } })
    .jpeg()
    .toBuffer();

function build(fields: Record<string, string> = {}, files: [string, Buffer | Uint8Array, string][] = [], headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ ...valid, startedAt: String(Date.now() - 60_000), ...fields })) form.set(k, v);
  for (const [k, b, n] of files) form.append(k, new Blob([new Uint8Array(b)]), n);
  const req = new Request("http://localhost:3000/api/inquiry", {
    method: "POST",
    body: form,
    headers: { origin: "http://localhost:3000", host: "localhost:3000", "x-real-ip": `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers },
  });
  return req;
}

/** Request strips the Host/Content-Length a real server would set, so restore them. */
async function send(req: Request, overrides: Record<string, string> = {}) {
  const body = await req.arrayBuffer();
  const h = new Headers(req.headers);
  h.set("content-length", String(body.byteLength));
  h.set("host", "localhost:3000");
  for (const [k, v] of Object.entries(overrides)) h.set(k, v);
  const stub = new Request("http://localhost:3000/api/inquiry", { method: "POST", body, headers: { "content-type": req.headers.get("content-type")! } });
  // Native Request forbids setting some headers, so override the getter.
  Object.defineProperty(stub, "headers", { value: h });
  return POST(stub);
}
const result = async (r: Response) => ({ status: r.status, body: await r.json() });

describe("POST /api/inquiry", () => {
  it("delivers a valid inquiry and only then reports success", async () => {
    const { status, body } = await result(await send(build()));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    const mail = received[0];
    expect(mail.subject).toBe("Tattoo inquiry: Jamie Rivera, Inner left forearm");
    expect(mail.replyTo?.text).toContain("jamie@example.com");
    expect(mail.text).toContain("Weekday afternoons");
    expect(mail.text).toContain("not a confirmed appointment");
  });

  it("re-encodes attachments, strips metadata, and renames files", async () => {
    const jpg = await image();
    expect(jpg.includes("SECRET-EXIF-MARKER")).toBe(true);
    await send(build({}, [["referenceImages", jpg, "../../etc/passwd.jpg"], ["placementPhotos", jpg, "me.jpg"]]));
    const [a, b] = received[0].attachments;
    expect(a.filename).toBe("placement-1.jpg");
    expect(b.filename).toBe("reference-1.jpg");
    expect(b.content.includes("SECRET-EXIF-MARKER")).toBe(false);
    expect((await sharp(b.content).metadata()).width).toBe(2000);
  });

  it("does not report success when the mail server rejects", async () => {
    rejectAll = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = await result(await send(build()));
    spy.mockRestore();
    expect(status).toBe(502);
    expect(body.ok).toBe(false);
  });

  it("does not report success when delivery is not configured", async () => {
    const saved = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status } = await result(await send(build()));
    spy.mockRestore();
    process.env.SMTP_HOST = saved;
    expect(status).toBe(503);
    expect(received).toHaveLength(0);
  });

  it.each([
    ["name", "", "name"],
    ["email", "not-an-email", "email"],
    ["confirmEmail", "other@example.com", "confirmEmail"],
    ["phone", "123", "phone"],
    ["instagram", "bad handle!", "instagram"],
    ["description", "too short", "description"],
    ["budget", "$1", "budget"],
    ["earliestDate", "2001-01-01", "earliestDate"],
    ["adult", "", "adult"],
    ["understood", "", "understood"],
  ])("rejects invalid %s", async (field, value, errorKey) => {
    const { status, body } = await result(await send(build({ [field]: value })));
    expect(status).toBe(422);
    expect(body.fieldErrors[errorKey]).toBeTruthy();
    expect(received).toHaveLength(0);
  });

  it("blocks header injection through the name", async () => {
    const { status } = await result(await send(build({ name: "A\r\nBcc: victim@example.com" })));
    expect(status).toBe(422);
  });

  it("escapes HTML in the email", async () => {
    await send(build({ description: 'I want <script>alert("x")</script> as a tattoo design please' }));
    expect(received[0].html).not.toContain("<script>");
  });

  it("requires a photo for cover-ups", async () => {
    const { status, body } = await result(await send(build({ projectType: "Cover-up" })));
    expect(status).toBe(422);
    expect(body.fieldErrors.placementPhotos).toBeTruthy();
  });

  it("rejects non-images despite a .jpg name", async () => {
    const { status } = await result(await send(build({}, [["referenceImages", Buffer.from("<svg onload=alert(1)>"), "x.jpg"]])));
    expect(status).toBe(422);
    expect(received).toHaveLength(0);
  });

  it("rejects truncated images with a valid signature", async () => {
    const trunc = (await image()).subarray(0, 40);
    const { status } = await result(await send(build({}, [["referenceImages", trunc, "x.jpg"]])));
    expect(status).toBe(422);
  });

  it("rejects too many files", async () => {
    const jpg = await image();
    const many = Array.from({ length: 5 }, () => ["referenceImages", jpg, "a.jpg"] as [string, Buffer, string]);
    const { status, body } = await result(await send(build({}, many)));
    expect(status).toBe(422);
    expect(body.fieldErrors.referenceImages).toBeTruthy();
  });

  it("rejects oversized bodies before reading them", async () => {
    const { status } = await result(await send(build(), { "content-length": "9000000" }));
    expect(status).toBe(413);
  });

  it("rejects a filled honeypot", async () => {
    const { status } = await result(await send(build({ website: "http://spam.example" })));
    expect(status).toBe(400);
    expect(received).toHaveLength(0);
  });

  it("rejects implausibly fast submissions", async () => {
    const { status } = await result(await send(build({ startedAt: String(Date.now() - 500) })));
    expect(status).toBe(400);
  });

  it("rejects cross-origin posts", async () => {
    const { status } = await result(await send(build(), { origin: "https://evil.example" }));
    expect(status).toBe(403);
  });

  it("rate limits repeat submissions by IP", async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await send(build(), { "x-real-ip": "10.9.9.9" })).status;
    expect(last).toBe(429);
  });
});
