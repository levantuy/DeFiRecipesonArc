# DeFi Recipes on Arc — Documentation Site

Standalone [Fumadocs](https://fumadocs.dev) + Next.js documentation app. It is intentionally
independent from `web/` and `keeper/` in this monorepo — it has its own `package.json`,
lockfile-free install, and build output, so it can be deployed on its own to
`docs.defirecipes.com` without depending on the rest of the workspace.

## What it uses

- **Fumadocs UI** (`fumadocs-ui`) for the docs layout, responsive sidebar/navigation,
  table of contents with active-section highlighting, and built-in search UI.
- **Fumadocs MDX** (`fumadocs-mdx`) to load Markdown/MDX from [content/docs](content/docs)
  and to configure Shiki syntax highlighting for `solidity`, `dotenv`, `text`, and a few
  other common languages (see [source.config.ts](source.config.ts)).
- **Fumadocs Core** (`fumadocs-core`) for the page-tree loader and the search API route.
- Tailwind CSS v4 (CSS-first config) for styling, layered on top of Fumadocs' own stylesheet.

No custom docs layout, sidebar, or search implementation was built — all of that is provided
by Fumadocs. Content is Vietnamese and kept with full diacritics as-is.

## Local development

```bash
pnpm install
pnpm dev
```

The site starts at `http://localhost:3000` and redirects to `/docs/contracts-overview`.

## Adding more pages

Add `.mdx` files under `content/docs/` and list them in `content/docs/meta.json` to control
sidebar order. Each page needs `title`/`description` frontmatter.

## Build & deploy

```bash
pnpm build
pnpm start
```

> With `output: 'standalone'`, `next start` prints a warning and Node should instead run
> `node .next/standalone/server.js` for production deployments — `pnpm build && pnpm start`
> remains fine for local verification.

`next.config.mjs` sets `output: 'standalone'` for self-hosted Node/Docker deployments, which
produces a self-contained `.next/standalone` bundle. This is skipped automatically when the
`VERCEL` environment variable is present, since Vercel performs its own output tracing and
fails the build (`ENOENT ... next-server.js.nft.json`) if `output: 'standalone'` is left on.
Either way, this app builds and deploys independently of the other apps in this repository —
point Vercel (or any other host) at `docs-site/` as the project root for `docs.defirecipes.com`.
