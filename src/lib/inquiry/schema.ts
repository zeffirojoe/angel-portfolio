import { z } from "zod";
import { ageGroups, budgets, projectTypes, sizes, styles } from "./fields";

// Rejects control characters, which also rules out header injection via newlines.
const line = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Please enter ${label}.`)
    .max(max, `Please keep this under ${max} characters.`)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Please remove line breaks and special characters.");

const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Please keep this under ${max} characters.`)
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Please remove line breaks and special characters.")
    .optional()
    .default("");

const links = (v: string) => (v.match(/https?:\/\//gi) ?? []).length;

export const inquirySchema = z
  .object({
    name: line("your name", 100),
    email: z.string().trim().toLowerCase().max(254).pipe(z.email("Please enter a valid email address.")),
    confirmEmail: z.string().trim().toLowerCase(),
    phone: optionalLine(30).refine((v) => {
      if (!v) return true;
      const digits = v.replace(/\D/g, "");
      return /^[\d\s().+-]+$/.test(v) && (digits.length === 10 || (digits.length === 11 && digits.startsWith("1")));
    }, "Please enter a 10-digit US phone number."),
    instagram: optionalLine(31).refine(
      (v) => v === "" || /^@?[a-zA-Z0-9._]{1,30}$/.test(v),
      "Please enter a valid Instagram handle.",
    ),
    projectType: z.enum(projectTypes, "Please choose one."),
    style: z.enum(styles, "Please choose a style."),
    description: z
      .string()
      .trim()
      .min(20, "Please describe your idea in a little more detail.")
      .max(3000, "Please keep this under 3,000 characters.")
      .refine((v) => links(v) <= 5, "Please remove some links and attach images instead."),
    placement: line("the placement", 120),
    size: z.enum(sizes, "Please choose an approximate size."),
    earliestDate: z
      .string()
      .trim()
      .optional()
      .default("")
      .refine((v) => {
        if (!v) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return false;
        // One day of grace for visitors in time zones behind the server.
        return Date.parse(v) >= Date.now() - 2 * 86_400_000;
      }, "Please choose a date in the future."),
    availability: z
      .string()
      .trim()
      .min(3, "Please tell Angel when you are generally free.")
      .max(500, "Please keep this under 500 characters."),
    budget: z.enum(budgets, "Please choose a budget range."),
    returning: z.enum(["Yes", "No"], "Please choose one."),
    notes: z
      .string()
      .trim()
      .max(1500, "Please keep this under 1,500 characters.")
      .refine((v) => links(v) <= 5, "Please remove some links.")
      .optional()
      .default(""),
    ageGroup: z
      .enum(ageGroups, "Please choose your age.")
      .refine((v) => v !== "Under 16", "Clients must be at least 16 years old."),
    ageConfirmed: z.literal("on", "Please confirm this before sending."),
    understood: z.literal("on", "Please confirm you understand this is an inquiry."),
  })
  .refine((d) => d.email === d.confirmEmail, {
    path: ["confirmEmail"],
    message: "These email addresses don't match.",
  });

export type Inquiry = z.infer<typeof inquirySchema>;
