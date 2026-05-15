# Emergency redeploy — Universe CRM was broken on `#/qualification`

## Why this PR exists

On 2026-05-15, `https://universe.spectrumadvanced.com/#/qualification` was
crashing at startup with:

```
ReferenceError: replyTemplates is not defined
    at index-Dcicd3Ao.js:…
```

That `index-Dcicd3Ao.js` bundle was an older build that contained an
unfinished BD-stage email-template feature inside `BDRow`
(`pages/Qualification.tsx`) which referenced `replyTemplates` and
`currentUserEmail` as free identifiers — never destructured from props,
never declared in scope. The first render of `#/qualification` threw.

The current `main` of this repo already has the correct, working bundle
at `assets/index-5siIj27i.js` (built from source commit `c79fc79`).
The CRM live host (Cloudflare Pages, custom domain
`universe.spectrumadvanced.com`) is still serving the older
`index-Dcicd3Ao.js`, so what is needed is a redeploy of this repo's
current `main` to the CRM Pages project — there are no asset diffs to
land beyond what is already on `main`.

## What this PR changes

Documentation only — `REDEPLOY.md` added at the repo root. No asset,
HTML, supabase, or workflow files touched. The CRM bundle in
`assets/index-5siIj27i.js` was verified byte-for-byte against a fresh
`npx vite build` from source `main` (`c79fc79`) and matches.

## How to actually redeploy

The deploy workflow at `.github/workflows/deploy.yml` only pushes
`public/` (landing pages) to the `universecrm-landing` Cloudflare Pages
project. **The CRM assets at the repo root are not auto-deployed by
this workflow.** Until that pipeline is wired up, the CRM redeploy is
manual:

1. From a workstation with `wrangler` installed and authenticated
   against the Spectrum Cloudflare account, from the root of this repo
   on the `main` branch (or this PR's branch after merge):

   ```bash
   wrangler pages deploy . \
     --project-name=<crm-pages-project-name> \
     --branch=main \
     --commit-dirty=true
   ```

   The CRM Pages project name is the one whose custom domain is
   `universe.spectrumadvanced.com` — confirm in the Cloudflare
   dashboard. It is not `universecrm-landing` (that one serves the
   marketing landing pages at the root domain).

2. Confirm the deploy in Cloudflare and hard-reload
   `https://universe.spectrumadvanced.com/#/qualification` (or
   bypass the cache with `?cb=<timestamp>`).

3. After reload, the bundle URL in the page source should change from
   `assets/index-Dcicd3Ao.js` to `assets/index-5siIj27i.js`.

## Verification expectations after redeploy

| Route | Expected |
|---|---|
| `#/qualification` | Renders BD pipeline, **no console `ReferenceError`** |
| `#/inquiries` | Web Inquiries list loads; selecting an inquiry shows a smart-reply draft (PR #15/#16) |
| `#/admin/reply-templates` | Editor loads. If `reply_templates` Supabase table missing, an amber warning surfaces and edits fall back to in-code defaults (graceful) |
| `#/qualify/<division>?lead=<id>` | Customer continuation page loads without auth |

## Companion source PR

`mlippmann19/spectrum-universe#18` — adds a post-build verifier
(`apps/spectrum-crm/script/verify-bundle.ts`) that scans the production
bundle for `replyTemplates` / `currentUserEmail` and fails `npm run
build` on hit. Verified against the live broken bundle (correctly
fails) and the current build (correctly passes). This stops the same
regression from leaking into a future deploy.

## Future hardening (out of scope here)

The `.github/workflows/deploy.yml` workflow should be extended with a
third job that runs `wrangler pages deploy .` against the CRM project
on every push to `main`. Once that ships, the manual step above
becomes unnecessary and the live host stays in lockstep with this
repo's `main`.
