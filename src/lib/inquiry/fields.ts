/** Options shared by the form and the server validator. */
export const projectTypes = ["New tattoo", "Cover-up", "Touch-up or rework"] as const;
export const styles = ["Fine line", "Black and grey realism", "Botanical or floral", "Lettering", "Not sure yet"] as const;
export const sizes = [
  "Tiny (under 2 in)",
  "Small (2 to 4 in)",
  "Medium (4 to 6 in)",
  "Large (6 to 10 in)",
  "Extra large (over 10 in)",
  "Sleeve or full panel",
  "Not sure yet",
] as const;
export const budgets = [
  "Under $200",
  "$200 to $500",
  "$500 to $1,000",
  "$1,000 to $2,000",
  "Over $2,000",
  "Not sure yet",
] as const;

export const limits = {
  /** Under the 4.5 MB request cap on common serverless hosts such as Vercel. */
  maxBodyBytes: 4_400_000,
  maxPlacementPhotos: 2,
  maxReferenceImages: 4,
  minFillMs: 3000,
} as const;
