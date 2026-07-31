# Zero to Production — Interactive Reader

World-class VitePress reader for *Mastering Docker and Kubernetes*.

Markdown in [`../mastering-docker-k8s-book/`](../mastering-docker-k8s-book/) remains the source of truth (GitHub-friendly). This site syncs that content into `docs/` at dev/build time and wraps it in a custom theme: Fraunces / Source Serif 4 / DM Sans / IBM Plex Mono, slate–cyan atmosphere, reading progress, focus mode, and three-tier teaching chrome.

## Quick start

```bash
cd book-site
npm install
npm run dev
```

Open the URL VitePress prints (usually `http://localhost:5173`).

```bash
npm run build    # production static site → .vitepress/dist
npm run preview  # preview the build
npm run sync     # refresh docs/ from the book without starting the server
```

> **Windows note:** The workspace path contains `&`. Scripts call VitePress via `node ./node_modules/vitepress/bin/vitepress.js` so npm bin shims do not break on that character.

## What you get

- Brand-first home (**Zero to Production**) with path chooser and resume CTA
- Sidebar progress (% of chapters visited, stored in `localStorage`)
- Focus mode (hides sidebar, widens measure)
- Styled **In plain terms** / **Under the hood** / **In production** bands
- Highlighted Production floor and Common Pitfall callouts
- Local search + Mermaid diagrams

## Editing content

Edit files under `mastering-docker-k8s-book/`, then restart `npm run dev` (or run `npm run sync`) so `docs/` picks up changes.
