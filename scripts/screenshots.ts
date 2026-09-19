/**
 * Captures the screenshots used in the README.
 *
 * An optional developer tool. Playwright is deliberately *not* a dependency of
 * this project — nothing in the test suite, the build or CI needs a browser
 * binary, and adding 300 MB of them to every install so the README can have
 * pictures is a poor trade.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run dev            # in another terminal
 *   npm run screenshots
 *
 * The file is excluded from the typecheck and the lint for the same reason.
 */

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — optional dependency, see the note above.
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs')
const base = process.env.PARALLAX_URL ?? 'http://localhost:5173'

interface Shot {
  readonly file: string
  readonly width: number
  readonly height: number
  readonly theme: 'dark' | 'light'
  readonly setup: (page: Page) => Promise<void>
}

/** Minimal structural type, so this file needs no Playwright types. */
interface Page {
  goto(url: string): Promise<unknown>
  evaluate(fn: string): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  setViewportSize(size: { width: number; height: number }): Promise<void>
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>
}

const loadDemo = `async () => {
  const buttons = [...document.querySelectorAll('button')]
  buttons.find((b) => b.textContent.includes('Load the sample register'))?.click()
  await new Promise((r) => setTimeout(r, 1400))
}`

const go = (view: string, wait = 600): string => `async () => {
  const nav = [...document.querySelectorAll('nav button')]
  nav.find((b) => b.textContent.trim() === '${view}')?.click()
  await new Promise((r) => setTimeout(r, ${wait}))
}`

const SHOTS: readonly Shot[] = [
  {
    file: 'parallax-hero.png',
    width: 1600,
    height: 1000,
    theme: 'dark',
    setup: async () => {},
  },
  {
    file: 'parallax-overview.png',
    width: 1600,
    height: 1100,
    theme: 'dark',
    setup: async (page) => {
      await page.evaluate(loadDemo)
    },
  },
  {
    file: 'parallax-matrix.png',
    width: 1600,
    height: 1000,
    theme: 'dark',
    setup: async (page) => {
      await page.evaluate(loadDemo)
      await page.evaluate(go('Matrix'))
      await page.evaluate(`async () => {
        document.querySelector('[data-cell="L4I3"]')?.click()
        await new Promise((r) => setTimeout(r, 900))
      }`)
    },
  },
  {
    file: 'parallax-measurement.png',
    width: 1600,
    height: 1400,
    theme: 'dark',
    setup: async (page) => {
      await page.evaluate(loadDemo)
      await page.evaluate(go('Measurement'))
    },
  },
  {
    file: 'parallax-compression.png',
    width: 1600,
    height: 1200,
    theme: 'dark',
    setup: async (page) => {
      await page.evaluate(loadDemo)
      await page.evaluate(go('Compression'))
    },
  },
  {
    file: 'parallax-simulate.png',
    width: 1600,
    height: 1200,
    theme: 'dark',
    setup: async (page) => {
      await page.evaluate(loadDemo)
      await page.evaluate(go('Simulate', 1400))
    },
  },
  {
    file: 'parallax-decision.png',
    width: 1600,
    height: 1400,
    theme: 'dark',
    setup: async (page) => {
      await page.evaluate(loadDemo)
      await page.evaluate(go('Decision'))
    },
  },
  {
    file: 'parallax-light.png',
    width: 1600,
    height: 1000,
    theme: 'light',
    setup: async (page) => {
      await page.evaluate(loadDemo)
      await page.evaluate(go('Quantify'))
    },
  },
  {
    file: 'parallax-mobile.png',
    width: 390,
    height: 844,
    theme: 'dark',
    setup: async (page) => {
      await page.evaluate(loadDemo)
      await page.evaluate(go('Matrix'))
      await page.evaluate(`async () => {
        document.querySelector('[data-cell="L4I3"]')?.click()
        await new Promise((r) => setTimeout(r, 900))
      }`)
    },
  },
]

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch()

  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
      colorScheme: shot.theme,
    })
    const page = (await context.newPage()) as unknown as Page
    await page.goto(base)
    await page.evaluate(
      `() => localStorage.setItem('parallax.theme', '${shot.theme}')`,
    )
    await page.goto(base)
    await page.waitForTimeout(500)
    await shot.setup(page)
    await page.screenshot({ path: join(outDir, shot.file) })
    await context.close()
    console.log(`wrote docs/${shot.file}`)
  }

  await browser.close()
}

void main()
