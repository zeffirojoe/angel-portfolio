import nodemailer from "nodemailer";
import type { CleanImage } from "./images";
import type { Inquiry } from "./schema";

export type DeliveryConfig = {
  host: string;
  port: number;
  user?: string;
  password?: string;
  from: string;
  to: string;
  /** Tests only: allows a local server without TLS. */
  insecure?: boolean;
};

export function deliveryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeliveryConfig | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, EMAIL } = env;
  const from = SMTP_FROM || SMTP_USER;
  if (!SMTP_HOST || !EMAIL || !from) return null;
  return {
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 465,
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    from,
    to: EMAIL,
    insecure: env.SMTP_INSECURE_FOR_TESTS === "1" && env.NODE_ENV !== "production",
  };
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildMessage(inquiry: Inquiry, placement: CleanImage[], references: CleanImage[]) {
  const handle = inquiry.instagram.replace(/^@/, "");
  const rows: [string, string][] = [
    ["Name", inquiry.name],
    ["Email", inquiry.email],
    ["Phone", inquiry.phone || "Not provided"],
    ["Instagram", handle ? `@${handle}` : "Not provided"],
    ["Age", inquiry.ageGroup === "16 or 17" ? "16 or 17 (minor: parent or guardian will attend)" : inquiry.ageGroup],
    ["Returning client", inquiry.returning],
    ["Project", inquiry.projectType],
    ["Style", inquiry.style],
    ["Placement", inquiry.placement],
    ["Size", inquiry.size],
    ["Budget", inquiry.budget],
    ["Earliest date", inquiry.earliestDate || "Flexible"],
    ["Availability", inquiry.availability],
  ];
  const text = [
    "New tattoo inquiry. This is not a confirmed appointment. Reply to this email to answer the client.",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Idea:",
    inquiry.description,
    ...(inquiry.notes ? ["", "Notes:", inquiry.notes] : []),
    "",
    `Attachments: ${placement.length} placement photo(s), ${references.length} reference image(s)`,
  ].join("\n");

  const para = (s: string) => esc(s).replace(/\n/g, "<br>");
  const html = `<div style="font-family:Georgia,serif;max-width:620px;color:#17131a">
<h2 style="font-weight:normal;margin:0 0 4px">Tattoo inquiry from ${esc(inquiry.name)}</h2>
<p style="margin:0 0 16px;color:#6b6270">Not a confirmed appointment. Reply to this email to answer the client.</p>
<table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b6270;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0">${esc(v)}</td></tr>`).join("\n")}
</table>
<h3 style="font-weight:normal;margin:20px 0 4px">The idea</h3>
<p style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${para(inquiry.description)}</p>
${inquiry.notes ? `<h3 style="font-weight:normal;margin:20px 0 4px">Notes</h3><p style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${para(inquiry.notes)}</p>` : ""}
<p style="margin:20px 0 0;color:#6b6270;font-family:Arial,sans-serif;font-size:13px">Attached: ${placement.length} placement photo(s), ${references.length} reference image(s).</p>
</div>`;

  return {
    subject: `Tattoo inquiry: ${inquiry.name}, ${inquiry.placement}`,
    text,
    html,
    replyTo: { name: inquiry.name, address: inquiry.email },
    attachments: [...placement, ...references].map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: "image/jpeg",
    })),
  };
}

/** Resolves only once the SMTP server has accepted the message for the artist's address. */
export async function sendInquiry(config: DeliveryConfig, message: ReturnType<typeof buildMessage>) {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: !config.insecure && config.port === 465,
    ignoreTLS: !!config.insecure,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  const info = await transport.sendMail({ from: config.from, to: config.to, ...message });
  const accepted = (info.accepted as (string | { address: string })[]).map((a) =>
    (typeof a === "string" ? a : a.address).toLowerCase(),
  );
  if (!accepted.includes(config.to.toLowerCase()) || info.rejected.length > 0) {
    throw new Error("SMTP server did not accept the recipient");
  }
}
