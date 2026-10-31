import { NextResponse } from "next/server";
import { buildMessage, deliveryConfigFromEnv, sendInquiry } from "@/lib/inquiry/email";
import { limits } from "@/lib/inquiry/fields";
import { cleanImage, UploadError, type CleanImage } from "@/lib/inquiry/images";
import { inquirySchema } from "@/lib/inquiry/schema";
import { clientIp, looksAutomated, rateLimited, sameOrigin } from "@/lib/inquiry/spam";

type Body = { ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string> };

const reply = (body: Body, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const files = (form: FormData, key: string) =>
  form.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);

export async function POST(request: Request) {
  const { headers } = request;

  if (!sameOrigin(headers)) {
    return reply({ ok: false, message: "This request couldn't be verified. Please reload and try again." }, 403);
  }
  if (rateLimited(clientIp(headers))) {
    return reply({ ok: false, message: "Too many inquiries from this connection. Please try again later." }, 429);
  }

  // Checked before reading the body, so oversized requests are never buffered.
  const length = Number(headers.get("content-length"));
  if (!length) return reply({ ok: false, message: "We couldn't read that submission. Please try again." }, 411);
  if (length > limits.maxBodyBytes) {
    return reply({ ok: false, message: "Your images are too large together. Please remove one and try again." }, 413);
  }
  if (!headers.get("content-type")?.startsWith("multipart/form-data")) {
    return reply({ ok: false, message: "We couldn't read that submission. Please try again." }, 415);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply({ ok: false, message: "We couldn't read that submission. Please try again." }, 400);
  }

  if (looksAutomated(form.get("website"), form.get("startedAt"))) {
    return reply({ ok: false, message: "That was submitted too quickly. Please wait a moment and try again." }, 400);
  }

  const fields: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") fields[key] = value;

  const parsed = inquirySchema.safeParse(fields);
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
  }

  const placementFiles = files(form, "placementPhotos");
  const referenceFiles = files(form, "referenceImages");
  if (placementFiles.length > limits.maxPlacementPhotos) {
    fieldErrors.placementPhotos = `Please attach up to ${limits.maxPlacementPhotos} placement photos.`;
  }
  if (referenceFiles.length > limits.maxReferenceImages) {
    fieldErrors.referenceImages = `Please attach up to ${limits.maxReferenceImages} reference images.`;
  }
  if (fields.projectType === "Cover-up" && placementFiles.length === 0) {
    fieldErrors.placementPhotos = "Please attach a recent photo of the tattoo you want to cover.";
  }

  if (Object.keys(fieldErrors).length > 0 || !parsed.success) {
    return reply({ ok: false, message: "Please check the highlighted fields.", fieldErrors }, 422);
  }

  let placement: CleanImage[];
  let references: CleanImage[];
  try {
    placement = await Promise.all(placementFiles.map((f, i) => cleanImage(f, `placement-${i + 1}`)));
    references = await Promise.all(referenceFiles.map((f, i) => cleanImage(f, `reference-${i + 1}`)));
  } catch (e) {
    if (e instanceof UploadError) {
      return reply({ ok: false, message: e.message, fieldErrors: { referenceImages: e.message } }, 422);
    }
    throw e;
  }

  const delivery = deliveryConfigFromEnv();
  if (!delivery) {
    console.error("[inquiry] delivery is not configured (SMTP_HOST, SMTP_USER/SMTP_FROM, EMAIL)");
    return reply({ ok: false, message: "Online booking is temporarily unavailable." }, 503);
  }

  try {
    await sendInquiry(delivery, buildMessage(parsed.data, placement, references));
  } catch (e) {
    // Only the error's class and code: no client data or SMTP credentials.
    const code = e && typeof e === "object" && "code" in e ? String(e.code) : "unknown";
    console.error(`[inquiry] delivery failed (${code})`);
    return reply({ ok: false, message: "The email service had a problem on our end." }, 502);
  }

  return reply({ ok: true });
}
