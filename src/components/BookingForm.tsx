"use client";

import { useEffect, useRef, useState } from "react";
import { ageGroups, budgets, limits, projectTypes, sizes, styles } from "@/lib/inquiry/fields";
import { site } from "@/lib/site";

type Attachment = { id: string; name: string; blob: Blob; preview: string };
type Bucket = "placementPhotos" | "referenceImages";
type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; message: string; retryable: boolean }
  | { kind: "sent"; email: string; name: string };

const NETWORK_FAILURE = "We couldn't reach the server. Check your connection and try again.";

/**
 * Downscales in the browser. Phone photos become a few hundred KB, which keeps uploads
 * fast and the whole request under the server limit. Also converts HEIC where the
 * browser can decode it. The server validates and re-encodes regardless.
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const attempts = [
      { edge: 1800, quality: 0.8 },
      { edge: 1400, quality: 0.72 },
      { edge: 1100, quality: 0.65 },
    ];
    let blob: Blob | null = null;
    for (const { edge, quality } of attempts) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
      if (blob && blob.size <= 650_000) return blob;
    }
    if (!blob) throw new Error("encode failed");
    return blob;
  } finally {
    bitmap.close();
  }
}

function Field({
  name,
  label,
  hint,
  optional,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`field${error ? " field-invalid" : ""}`}>
      <label htmlFor={name}>
        {label}
        {optional && <span className="field-optional"> (optional)</span>}
      </label>
      {hint && (
        <p className="field-hint" id={`${name}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p className="field-error" id={`${name}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

function Choice({
  name,
  legend,
  options,
  error,
  onChoose,
}: {
  name: string;
  legend: string;
  options: readonly string[];
  error?: string;
  onChoose?: (value: string) => void;
}) {
  return (
    <fieldset className={`choice${error ? " field-invalid" : ""}`} aria-describedby={error ? `${name}-error` : undefined}>
      <legend>{legend}</legend>
      <div className="chips">
        {options.map((o) => (
          <label key={o} className="chip">
            <input type="radio" name={name} value={o} required onChange={() => onChoose?.(o)} />
            <span>{o}</span>
          </label>
        ))}
      </div>
      {error && (
        <p className="field-error" id={`${name}-error`}>
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * Meta's API can't start a DM to the artist, but the client can. ig.me links have no
 * documented way to prefill text, so the note is copied for them to paste.
 */
function DmNudge({ name, email }: { name: string; email: string }) {
  const [copied, setCopied] = useState(false);
  const note = `Hi Angel! I just sent a tattoo inquiry through your website. It's under ${name} (${email}), so please check your email when you get a chance.`;
  return (
    <div className="dm-note">
      <h4>Want to give Angel a heads-up?</h4>
      <p>Optional: send this note from your own Instagram so Angel knows to look for your email.</p>
      <blockquote>{note}</blockquote>
      <a
        className="btn btn-ink"
        href={`https://ig.me/m/${site.handle}`}
        target="_blank"
        rel="noreferrer"
        onClick={() => {
          navigator.clipboard?.writeText(note).then(
            () => setCopied(true),
            () => {},
          );
        }}
      >
        Copy note and open Instagram
      </a>
      <p className="field-hint" aria-live="polite">
        {copied ? "Copied. Paste it into the chat and send." : "This doesn't send anything by itself."}
      </p>
    </div>
  );
}

export function BookingForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [processing, setProcessing] = useState(false);
  const [age, setAge] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<Bucket, Attachment[]>>({ placementPhotos: [], referenceImages: [] });
  const previews = useRef<Attachment[]>([]);

  useEffect(() => {
    startedAt.current = Date.now();
    return () => previews.current.forEach((a) => URL.revokeObjectURL(a.preview));
  }, []);

  useEffect(() => {
    if (status.kind === "sent") successRef.current?.focus();
    if (status.kind === "error") errorRef.current?.focus();
  }, [status]);

  const describedBy = (name: string, hint = false) =>
    [hint && `${name}-hint`, errors[name] && `${name}-error`].filter(Boolean).join(" ") || undefined;
  const aria = (name: string, hint = false) => ({
    "aria-invalid": errors[name] ? (true as const) : undefined,
    "aria-describedby": describedBy(name, hint),
  });

  async function addFiles(bucket: Bucket, list: FileList | null, max: number) {
    if (!list?.length) return;
    setProcessing(true);
    setErrors((current) => {
      const next = { ...current };
      delete next[bucket];
      return next;
    });
    const room = max - files[bucket].length;
    const chosen = Array.from(list).slice(0, Math.max(0, room));
    const added: Attachment[] = [];
    let problem = list.length > room ? `You can attach up to ${max} images here.` : "";
    for (const file of chosen) {
      try {
        const blob = await shrink(file);
        const a = { id: crypto.randomUUID(), name: file.name, blob, preview: URL.createObjectURL(blob) };
        added.push(a);
        previews.current.push(a);
      } catch {
        problem = `"${file.name}" couldn't be read. Please use a JPEG, PNG or WebP image.`;
      }
    }
    setFiles((f) => ({ ...f, [bucket]: [...f[bucket], ...added] }));
    if (problem) setErrors((e) => ({ ...e, [bucket]: problem }));
    setProcessing(false);
  }

  function removeFile(bucket: Bucket, id: string) {
    setFiles((f) => ({ ...f, [bucket]: f[bucket].filter((a) => a.id !== id) }));
    const a = previews.current.find((p) => p.id === id);
    if (a) URL.revokeObjectURL(a.preview);
    previews.current = previews.current.filter((p) => p.id !== id);
  }

  function focusFirstError(found: Record<string, string>) {
    const form = formRef.current;
    if (!form) return;
    const first = Array.from(form.elements).find(
      (el): el is HTMLElement => el instanceof HTMLElement && "name" in el && (el as HTMLInputElement).name in found,
    );
    first?.focus();
  }

  function clientValidate(form: HTMLFormElement) {
    const found: Record<string, string> = {};
    for (const el of Array.from(form.elements)) {
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        if (el.name && !el.validity.valid && !found[el.name]) {
          found[el.name] = el.validationMessage;
        }
      }
    }
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim().toLowerCase();
    const confirm = String(data.get("confirmEmail") ?? "").trim().toLowerCase();
    if (email && confirm && email !== confirm) found.confirmEmail = "These email addresses don't match.";
    if (data.get("projectType") === "Cover-up" && files.placementPhotos.length === 0) {
      found.placementPhotos = "Please attach a recent photo of the tattoo you want to cover.";
    }
    return found;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status.kind === "sending" || processing) return;
    const form = e.currentTarget;
    const found = clientValidate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setStatus({ kind: "idle" });
      focusFirstError(found);
      return;
    }

    const data = new FormData(form);
    data.set("startedAt", String(startedAt.current));
    (["placementPhotos", "referenceImages"] as const).forEach((bucket) => {
      data.delete(bucket);
      files[bucket].forEach((a, i) => data.append(bucket, a.blob, `${bucket}-${i}.jpg`));
    });

    setStatus({ kind: "sending" });
    let res: Response;
    try {
      res = await fetch("/api/inquiry", { method: "POST", body: data, signal: AbortSignal.timeout(60_000) });
    } catch {
      setStatus({ kind: "error", message: NETWORK_FAILURE, retryable: true });
      return;
    }
    const body = (await res.json().catch(() => null)) as {
      ok: boolean;
      message?: string;
      fieldErrors?: Record<string, string>;
    } | null;

    if (res.ok && body?.ok) {
      setStatus({ kind: "sent", email: String(data.get("email")).trim(), name: String(data.get("name")).trim() });
      return;
    }
    if (body?.fieldErrors && Object.keys(body.fieldErrors).length > 0) {
      setErrors(body.fieldErrors);
      setStatus({ kind: "error", message: body.message ?? "Please check the highlighted fields.", retryable: false });
      return;
    }
    setStatus({ kind: "error", message: body?.message ?? "Something went wrong on our end.", retryable: true });
  }

  if (status.kind === "sent") {
    return (
      <div className="form-success" ref={successRef} tabIndex={-1} role="status">
        <p className="eyebrow">Inquiry received</p>
        <h3>Thank you. Your idea is with Angel.</h3>
        <p>
          This isn&rsquo;t a confirmed appointment yet. Angel reviews each request personally and will reply to{" "}
          <strong>{status.email}</strong> if the project is a good fit, usually within {site.responseTime}. Please check
          your spam folder too.
        </p>
        <DmNudge name={status.name} email={status.email} />
      </div>
    );
  }

  const sending = status.kind === "sending";
  const uploader = (bucket: Bucket, label: string, hint: string, max: number) => (
    <div className={`field${errors[bucket] ? " field-invalid" : ""}`}>
      <label htmlFor={bucket}>
        {label} <span className="field-optional">(up to {max})</span>
      </label>
      <p className="field-hint" id={`${bucket}-hint`}>
        {hint}
      </p>
      <input
        className="file-input"
        id={bucket}
        name={bucket}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        disabled={files[bucket].length >= max || sending}
        onChange={(e) => {
          void addFiles(bucket, e.target.files, max);
          e.target.value = "";
        }}
        {...aria(bucket, true)}
      />
      {files[bucket].length > 0 && (
        <ul className="previews">
          {files[bucket].map((a) => (
            <li key={a.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img src={a.preview} alt={`Preview of ${a.name}`} />
              <button type="button" onClick={() => removeFile(bucket, a.id)} aria-label={`Remove ${a.name}`}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {errors[bucket] && (
        <p className="field-error" id={`${bucket}-error`}>
          {errors[bucket]}
        </p>
      )}
    </div>
  );

  return (
    <form ref={formRef} className="form" onSubmit={submit} noValidate aria-label="Tattoo booking inquiry">
      <div className="hp" aria-hidden="true">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <section className="form-group" aria-labelledby="g1">
        <h3 id="g1"><span>1</span> About you</h3>
        <div className="form-grid">
          <Field name="name" label="Full name" hint="The person getting tattooed." error={errors.name}>
            <input id="name" name="name" required maxLength={100} autoComplete="name" {...aria("name", true)} />
          </Field>
          <Field name="instagram" label="Instagram handle" optional error={errors.instagram}>
            <input id="instagram" name="instagram" maxLength={31} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="@yourhandle" {...aria("instagram")} />
          </Field>
          <Field name="email" label="Email" error={errors.email}>
            <input id="email" name="email" type="email" required autoComplete="email" inputMode="email" {...aria("email")} />
          </Field>
          <Field name="confirmEmail" label="Confirm email" error={errors.confirmEmail}>
            <input id="confirmEmail" name="confirmEmail" type="email" required autoComplete="email" inputMode="email" {...aria("confirmEmail")} />
          </Field>
          <Field name="phone" label="Mobile number" optional error={errors.phone}>
            <input id="phone" name="phone" type="tel" autoComplete="tel-national" inputMode="tel" placeholder="(732) 555-0123" {...aria("phone")} />
          </Field>
        </div>
        <Choice
          name="ageGroup"
          legend="How old will you be on the day of your tattoo?"
          options={ageGroups}
          error={errors.ageGroup}
          onChoose={(value) => {
            setAge(value);
            setStatus({ kind: "idle" });
            setErrors((current) => {
              const next = { ...current };
              delete next.ageGroup;
              delete next.ageConfirmed;
              return next;
            });
          }}
        />
        {age === "Under 16" && (
          <p className="age-note" role="status">
            Angel tattoos clients who are 16 or older. We&rsquo;d love to hear from you once you turn 16!
          </p>
        )}
        {age === "16 or 17" && (
          <p className="age-note" role="status">
            You&rsquo;re welcome to inquire. A parent or guardian who is 18 or older will need to come with you.
          </p>
        )}
        <div className="form-follow" hidden={age === "Under 16"}>
        <Choice name="returning" legend="Have you been tattooed by Angel before?" options={["No", "Yes"]} error={errors.returning} />
        </div>
      </section>

      <div className="form-rest" hidden={age === "Under 16"}>
      <section className="form-group" aria-labelledby="g2">
        <h3 id="g2"><span>2</span> The idea</h3>
        <Choice name="projectType" legend="What kind of project is this?" options={projectTypes} error={errors.projectType} />
        <Choice name="style" legend="Style" options={styles} error={errors.style} />
        <Field name="description" label="Tell Angel about it" hint="What you'd like and what it means to you." error={errors.description}>
          <textarea id="description" name="description" required minLength={20} maxLength={3000} rows={5} {...aria("description", true)} />
        </Field>
      </section>

      <section className="form-group" aria-labelledby="g3">
        <h3 id="g3"><span>3</span> Placement and size</h3>
        <div className="form-grid">
          <Field name="placement" label="Placement" error={errors.placement}>
            <input id="placement" name="placement" required maxLength={120} placeholder="Inner left forearm" {...aria("placement")} />
          </Field>
          <Field name="size" label="Approximate size" error={errors.size}>
            <select id="size" name="size" required defaultValue="" {...aria("size")}>
              <option value="" disabled>Choose a size</option>
              {sizes.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>
      </section>

      <section className="form-group" aria-labelledby="g4">
        <h3 id="g4"><span>4</span> Timing and budget</h3>
        <div className="form-grid">
          <Field name="earliestDate" label="Earliest date" optional error={errors.earliestDate}>
            <input id="earliestDate" name="earliestDate" type="date" {...aria("earliestDate")} />
          </Field>
          <Field name="budget" label="Budget (USD)" error={errors.budget}>
            <select id="budget" name="budget" required defaultValue="" {...aria("budget")}>
              <option value="" disabled>Choose a range</option>
              {budgets.map((b) => <option key={b}>{b}</option>)}
            </select>
          </Field>
        </div>
        <Field name="availability" label="General availability" hint="Days and times that usually work." error={errors.availability}>
          <input id="availability" name="availability" required minLength={3} maxLength={500} placeholder="Weekday afternoons, any Saturday" {...aria("availability", true)} />
        </Field>
      </section>

      <section className="form-group" aria-labelledby="g5">
        <h3 id="g5"><span>5</span> Images</h3>
        {uploader("placementPhotos", "Placement photos", "The area on your body. Required for cover-ups: show the current tattoo.", limits.maxPlacementPhotos)}
        {uploader("referenceImages", "Reference images", "Designs, drawings or photos that show the look and size you have in mind.", limits.maxReferenceImages)}
        <Field name="notes" label="Anything else?" optional error={errors.notes}>
          <textarea id="notes" name="notes" maxLength={1500} rows={3} {...aria("notes")} />
        </Field>
      </section>

      <section className="form-group form-final" aria-label="Confirm and send">
        {age && (
          // Keyed by age so changing the answer always asks for a fresh confirmation.
          <label key={age} className={`check${errors.ageConfirmed ? " field-invalid" : ""}`}>
            <input type="checkbox" name="ageConfirmed" required {...aria("ageConfirmed")} />
            <span>
              {age === "16 or 17"
                ? "I am 16 or 17, and a parent or guardian who is 18 or older will come with me and bring a valid government-issued photo ID."
                : "I am 18 or older and will bring a valid government-issued photo ID."}
            </span>
          </label>
        )}
        {errors.ageConfirmed && <p className="field-error" id="ageConfirmed-error">{errors.ageConfirmed}</p>}
        <label className={`check${errors.understood ? " field-invalid" : ""}`}>
          <input type="checkbox" name="understood" required {...aria("understood")} />
          <span>I understand this is an inquiry, not a confirmed appointment, and that not every request can be accepted.</span>
        </label>
        {errors.understood && <p className="field-error" id="understood-error">{errors.understood}</p>}

        {status.kind === "error" && (
          <div className="form-error" ref={errorRef} tabIndex={-1} role="alert">
            <p><strong>Your inquiry was not sent.</strong> {status.message}</p>
            {status.retryable && (
              <p>
                Everything you entered is still here, so you can try again, or{" "}
                <a href={`https://ig.me/m/${site.handle}`} target="_blank" rel="noreferrer">message Angel on Instagram</a>.
              </p>
            )}
          </div>
        )}

        <button type="submit" className="btn btn-ink btn-submit" disabled={sending || processing} aria-busy={sending}>
          {sending ? "Sending your inquiry…" : processing ? "Preparing images…" : "Send inquiry"}
        </button>
        <p className="form-privacy">
          Your details and images go only to Angel by email and aren&rsquo;t stored on this site.
        </p>
      </section>
      </div>
    </form>
  );
}
