# Paths and Proofs

A small family of privacy-first, local-first financial **decision** tools. Each
one resolves to a breakeven — the point where one path overtakes the other.
Everything runs in the browser; nothing is sent anywhere.

## Structure

```
/                       Landing page (index.html) — the site's front door
/core/                  Shared calculator engine (finance, chart, contract, controls)
                        — used by the calculator family only
/social-security/       Social Security claiming calculator (the anchor tool)
/rent-vs-buy/           Rent vs buy calculator
/roth-conversion/       Roth conversion calculator — its own self-contained front
                        end (Playfair/DM Sans, Chart.js). Does NOT use /core/.
/in-case-im-not-there/  The family vault — a standalone, offline, encrypted
                        document tool. Separate product; shares no engine code.
/shared/                Cross-site icons (theme toggle, print, vault actions).
                        Icons only — no shared palette or fonts (see shared/README.md).
/_dev/                  Dev tooling (verify-all.mjs). Not served.
```

Roth conversion (formerly "RothGuide") connects at the brand level: it has its
own self-contained front end and does **not** depend on the `/core/` engine. It
will share `/shared/` icons but keeps its own design and math. It was renamed to
match the family's plain-language naming.

## No build step

This is plain static HTML, CSS, and JavaScript (ES modules). There is nothing to
compile. Cloudflare Pages serves the files as-is.

- **Preview locally:** `npm run serve` then open <http://localhost:8000>
- **Verify the calculators:** `npm install` then `npm run verify`
  (mounts each calculator on the shared core and checks it renders)

## Before deploying — placeholders to resolve

Search the repo for these and replace once the values exist:

- `paths-and-proofs.pages.dev` — the canonical / Open Graph site URL (in `index.html`).
  Set this to the Cloudflare Pages URL (or custom domain) after first deploy.

## Deploying to Cloudflare Pages

Connect this repo as a Pages project with Git integration. Because there is no
build step, set:

- **Build command:** *(leave empty)*
- **Build output directory:** `/` (the repo root)

Every push to the production branch then deploys automatically, and every other
branch gets its own preview URL.

## A note on the engine boundary

`/core/` is the calculator engine and is domain-free — it knows nothing about
Social Security or rent-vs-buy specifically; each calculator supplies its own
`inputs` and `compute`. The vault and Roth conversion deliberately do **not**
depend on `/core/`. Keeping that boundary clean is what lets the family share
trust without coupling unrelated products.
