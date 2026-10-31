/** Public facts about the artist, taken from the public Instagram profile.
 *  Used whenever the API can't supply them, so the page never renders empty. */
export const site = {
  name: "Angel",
  title: "Tattooist Angel",
  handle: "tattooist_angel",
  instagramUrl: "https://www.instagram.com/tattooist_angel/",
  /** Confirm with the artist. */
  responseTime: "5 business days",
  specialties: "Fine line tattoos, black and grey realism",
  location: "East Brunswick, NJ",
  description:
    "Fine line tattoos and black and grey realism by Angel in East Brunswick, NJ. See recent work and send a booking inquiry.",
} as const;

/**
 * Shown through Instagram's public embed when the API can't supply posts.
 * Needs no token. Update these by hand; once the API works they are not used.
 */
export const featuredPermalinks: string[] = [
  "https://www.instagram.com/p/DTMAKZ6Dx_r/",
  "https://www.instagram.com/p/DNVfOV6tV4p/",
  "https://www.instagram.com/p/DaEBex3PX65/",
  "https://www.instagram.com/p/DW4wJXhj_91/",
  "https://www.instagram.com/p/DWMqJV6j-7T/",
  "https://www.instagram.com/p/DTwWiHwjGl_/",
];
