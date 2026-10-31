# Tattooist Angel: portfolio and booking inquiries

Next.js 16 site with an Instagram-powered portfolio and an email-delivered booking inquiry form.

```bash
npm install
cp .env.example .env   # then fill it in
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run ig:check` | Reports what `INSTAGRAM_ACCESS_TOKEN` can access. Never prints the token. |
| `npm test` | Unit and API tests, including delivery through a local SMTP server. |
| `npm run e2e` | Browser checks against a production build, with a fake Graph API and SMTP server. |
| `npm run e2e -- real` | The same browser checks using the real `.env`, without fakes. |

`e2e` needs Chromium: run `npx playwright install --with-deps chromium`.

## Setup still required

### 1. Instagram access

Connected through Unified Login. In the app dashboard, under the Instagram API setup page:

1. Use **Generate token** next to the account and set `INSTAGRAM_ACCESS_TOKEN`.
2. Copy the number under the account name into `INSTAGRAM_USER_ID`. These tokens can't list their own accounts, so
   `me/assigned_instagram_accounts` returns nothing even when access works.
3. Set `INSTAGRAM_USERNAME`. The site refuses to display an ID belonging to any other username.
4. Run `npm run ig:check`.

If the token stops working, the site serves its last good copy and then the public embeds; generate a new token to
recover.

### 2. Email delivery

Inquiries are sent over SMTP, and none is configured yet, so the form currently refuses submissions and says so.
For Gmail, turn on 2-Step Verification on the sending account, create an
[App Password](https://myaccount.google.com/apppasswords), and set:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=<sending Gmail address>
SMTP_PASSWORD=<16-character app password>
```

Any SMTP provider works. Set `SMTP_FROM` if the sender differs from `SMTP_USER`.

## How it behaves

**Portfolio.** The server fetches profile, posts and stories, and caches them for 30 minutes (5 minutes after a
failure). If a refresh fails, the last good copy is served for up to 7 days. With nothing to serve, the page falls
back to Instagram's public embeds of the posts in `src/lib/site.ts`, which need no token. Expired CDN links are
replaced on refresh. Hosting needs a persistent or warm `tmp` for the last-good copy to survive between instances;
without it the embeds still apply.

**Why inquiries don't go to Instagram DMs.** Meta's Messaging API only lets a business reply to someone who messaged
it first, addressed by an ID that arrives through a webhook. A web form can't start that conversation or message
the artist's own account, so this is a platform limit that better permissions wouldn't change. Instead, the success
screen offers the client an optional button that copies a "check your email" note and opens a DM to the artist from
the client's own Instagram.

**Inquiry security.** Same-origin check, per-IP rate limit, honeypot, minimum fill time and server-side validation.
Uploads are limited to 6 images and 4.4 MB per request, verified by content, fully re-encoded to strip metadata, and
never written to disk. The rate limit is per server instance, so add Cloudflare Turnstile if real spam appears.

**To confirm with the artist:** the reply time (`responseTime` in `src/lib/site.ts`), the bio copy in
`src/components/PortfolioSections.tsx`, and the budget and size options in `src/lib/inquiry/fields.ts`.
