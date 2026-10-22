# Publishing on GitHub Pages

This project deploys as a fully static site to GitHub Pages through
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).
Every push to `main` builds `dist/` and publishes it; no server, database or
secret is involved.

## What the published site does and does not have

The tide app is client-side: NOAA predictions, the station catalogue, the
surf/marine forecast and the camera list are all fetched straight from the
browser.

The GitHub Pages build leaves out the features that needed the Convex backend:

- **Buoys** — NDBC's observations file can't be fetched from a browser (no
  CORS), so buoy dots and their wind/wave/water popups are not part of this
  build. Gauge stations and surf cameras still are.
- **Sign-in** — the `/auth` page is not routed; `/` is public with no account.
- **WorldTides** — worldwide predictions required a server-held API key, so the
  map covers the NOAA gauge network instead.

The Convex backend sources in `src/convex/` and the auth helpers are kept for
the full version; the static build simply doesn't import them.

## One-time setup

1. **Create an empty repository** on GitHub (public, unless you're on a paid
   plan — GitHub Pages needs a public repo on the free plan). Do not add a
   README, `.gitignore` or licence: this project already has them.
2. **Push this project to it** (see below for the exact commands).
3. In the repository, open **Settings → Pages** and set **Source** to
   **GitHub Actions**. This has to happen once; the workflow can't enable it.
4. Push to `main` (or run the **Deploy to GitHub Pages** workflow from the
   Actions tab) and wait for the deploy job to finish. The site is at
   `https://<user>.github.io/<repo>/`.

### Pushing from this workspace

```bash
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin HEAD:main
```

To also make `main` the local branch:

```bash
git branch -M main
git push -u origin main
```

### Pushing from a copy of the project

If you clone the new empty repo and copy the project files into it:

```bash
git add .
git commit -m "Quick Tides"
git push -u origin main
```

## The base path

A project site is served from `/<repo>/`, so the build needs that prefix.
The workflow works it out from the repository name and passes it as
`VITE_BASE_PATH`; `vite.config.ts` feeds it to `base` and `src/main.tsx` gives
the router the same prefix. Building locally against a project site looks like:

```bash
VITE_BASE_PATH=/my-repo/ bun run build:pages
```

If you later attach a custom domain, the site moves to the domain root: change
the base step in the workflow to `echo "VITE_BASE_PATH=/" >> "$GITHUB_ENV"`
(or delete the step, since `/` is the default).

## Why `build:pages` instead of `build`

`bun run build` runs `tsc -b` first, which type-checks `src/convex/` and needs
the Convex-generated `src/convex/_generated/` directory. That directory is
produced by `npx convex dev` and is gitignored, so it is absent in CI. The
Pages build therefore runs `vite build` alone, and only bundles what the app
entry actually imports.

## Deep links

GitHub Pages answers unknown paths with `404.html`, so the workflow copies the
built `index.html` to `dist/404.html`. A link such as
`https://<user>.github.io/<repo>/auth` loads the app shell and the router takes
over. The URL still reports HTTP 404 — that is normal for single-page apps on
Pages.
