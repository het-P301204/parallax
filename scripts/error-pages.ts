/**
 * Static 403 / 404 / 500 pages.
 *
 * A single-page app served from static hosting needs these as real files: the
 * host serves them, not the bundle, so they cannot be React components and
 * they have to look like the product without loading it.
 *
 * They are generated from the same palette the app uses, inlined, so a page
 * that appears when the bundle is unreachable does not itself depend on a
 * stylesheet being reachable.
 *
 *   node scripts/error-pages.ts          write them
 *   node scripts/error-pages.ts --check  fail if they differ
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public')

interface Page {
  readonly file: string
  readonly code: string
  readonly title: string
  readonly body: string
}

const PAGES: readonly Page[] = [
  {
    file: '404.html',
    code: '404',
    title: 'No page here',
    body: 'PARALLAX is a single page. If you followed a link with a path on it, the path was never real — the whole application lives at the root, and nothing about your register was ever stored under a URL.',
  },
  {
    file: '403.html',
    code: '403',
    title: 'Not permitted',
    body: 'The host refused this request. Nothing was analysed and nothing was sent: PARALLAX reads a register inside your browser tab and has no server-side state for anyone to be denied.',
  },
  {
    file: '500.html',
    code: '500',
    title: 'The host failed',
    body: 'Something went wrong serving the page. Any register you had loaded existed only in the tab it was loaded in, so nothing of it is on this server to be affected.',
  },
]

function render(page: Page): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${page.code} — PARALLAX</title>
    <meta name="robots" content="noindex" />
    <meta name="color-scheme" content="dark light" />
    <meta name="referrer" content="no-referrer" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <style>
      :root {
        color-scheme: dark;
        --surface: #090b0f;
        --panel: #0f1218;
        --line: #2b3342;
        --ink: #f0f4f9;
        --ink-2: #9fabbd;
        --ink-3: #7d8a9e;
        --accent: #56b6f0;
      }
      @media (prefers-color-scheme: light) {
        :root {
          color-scheme: light;
          --surface: #f2f5f9;
          --panel: #ffffff;
          --line: #ccd4df;
          --ink: #0d1117;
          --ink-2: #495567;
          --ink-3: #5b6779;
          --accent: #0b6cb0;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 1.5rem;
        background: var(--surface);
        color: var(--ink);
        font: 400 15px/1.6 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
        background-image:
          linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
        background-size: 32px 32px;
      }
      main { max-width: 34rem; }
      .code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--ink-3);
        margin: 0 0 0.75rem;
      }
      h1 {
        margin: 0 0 1rem;
        font-size: 1.75rem;
        line-height: 1.2;
        letter-spacing: -0.02em;
        font-weight: 500;
      }
      p { margin: 0 0 1.25rem; color: var(--ink-2); font-size: 0.875rem; }
      a {
        display: inline-flex;
        align-items: center;
        height: 2.25rem;
        padding: 0 1rem;
        border-radius: 5px;
        border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
        background: color-mix(in srgb, var(--accent) 15%, transparent);
        color: var(--accent);
        font-size: 0.8125rem;
        text-decoration: none;
      }
      a:hover { background: color-mix(in srgb, var(--accent) 25%, transparent); }
      .mark { display: flex; align-items: center; gap: 0.625rem; margin-bottom: 2.5rem; }
      .mark span {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        letter-spacing: 0.2em;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">
        <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="5.5" y="9.5" width="7" height="13" rx="1.6" fill="rgba(86,182,240,0.22)" />
          <rect x="5.5" y="9.5" width="7" height="13" rx="1.6" fill="none" stroke="#56b6f0" stroke-width="1.3" />
          <rect x="15" y="10.4" width="12" height="2.6" rx="1.3" fill="#4aced6" />
          <rect x="15" y="14.7" width="7" height="2.6" rx="1.3" fill="#4aced6" opacity="0.66" />
          <rect x="15" y="19" width="10.5" height="2.6" rx="1.3" fill="#4aced6" opacity="0.4" />
        </svg>
        <span>PARALLAX</span>
      </div>
      <p class="code">Error ${page.code}</p>
      <h1>${page.title}</h1>
      <p>${page.body}</p>
      <a href="./">Back to the start</a>
    </main>
  </body>
</html>
`
}

function main(): void {
  const check = process.argv.includes('--check')
  mkdirSync(outDir, { recursive: true })

  let failed = false
  for (const page of PAGES) {
    const path = join(outDir, page.file)
    const content = render(page)
    if (!check) {
      writeFileSync(path, content, 'utf8')
      continue
    }
    let actual: string
    try {
      actual = readFileSync(path, 'utf8')
    } catch {
      console.error(`missing: public/${page.file}`)
      failed = true
      continue
    }
    if (actual !== content) {
      console.error(`stale: public/${page.file}. Run: node scripts/error-pages.ts`)
      failed = true
    }
  }

  if (check) {
    if (failed) process.exit(1)
    console.log(`error pages up to date (${PAGES.length})`)
    return
  }
  console.log(`wrote ${PAGES.length} error pages to public/`)
}

main()
