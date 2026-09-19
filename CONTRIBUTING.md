# Contributing

Thank you for looking. This is a small project with a narrow claim, and the
contributions that help most are the ones that test the claim rather than
widen it.

```bash
npm install
npm run dev      # the app
npm test         # 194 tests
npm run verify   # lint, typecheck, test, build, and every generated artifact
```

Node 24 or later. The CLI runs the engine's TypeScript sources directly under
Node's native type stripping, so `node bin/parallax.ts audit register.csv`
works without a build.

---

## Where things live

```
src/engine/    the mathematics. Pure, no DOM, no network, shared with the CLI.
src/ui/        design tokens, primitives, charts, the parallax stage
src/views/     one file per view
bin/           the CLI
scripts/       generators for the demo register, fixtures and error pages
fixtures/      the demo register and the byte-exact malformed files
```

Read `src/engine/types.ts` first. Every analysis is a pure function from those
types to those types, and the whole product is assembled from them.

---

## The rules that are not negotiable

These are what make the product's claims true. A change that breaks one of
them is a change to what PARALLAX *is*, and CI will catch it.

**1. No arithmetic in a component.** A view renders a number the engine
produced. Arithmetic in a component is arithmetic no test can reach, and the
first thing anybody will ask about a finding is how it was computed.

**2. No network, anywhere.** `connect-src 'none'` is in the document head, a
lint rule forbids `fetch` in the engine, and CI scans the built bundle. There
is no telemetry and there will not be one.

**3. No `Math.random` in the engine.** Every simulated number comes from a
seeded generator, enforced by lint. A percentile nobody can reproduce is not a
number anyone should quote.

**4. Every finding answers five questions.** What, why, on what assumption,
from what evidence, and what to do next. `ExplanationBlock` is the only thing
that renders them, so a finding cannot reach the screen with three of the five
answered. `analysis.test.ts` checks every finding the demo register produces.

**5. No invented differences.** Two risks in one cell with no estimates of
their own are, as far as the register is concerned, the same risk. They get
identical models and are drawn identically. Making them look different would
be the exact error this product exists to find.

**6. Never "true risk".** Not in code, not in a string, not in the README.
Prefer *modelled*, *candidate*, *under the configured assumptions*. A test
asserts the phrase never appears in the output.

**7. Never accuse an assessor.** Calibration findings describe *variation*.
There is no ground truth in a risk register to be wrong about, and a tool that
forgets that will not be used twice.

---

## Adding an analysis

1. Put the shapes in `src/engine/types.ts`, with a doc comment that says what
   the finding means and what it does not.
2. Write the analysis as a pure function in its own file. The comment at the
   top should be the argument for the method — someone should be able to
   disagree with it on the evidence of the comment alone.
3. State the failure mode. If there is data on which the method has no power,
   say so in the comment and pin it with a test. The calibration module is the
   worked example.
4. Return `insufficient-data` where the register cannot answer. Never a
   confident-looking default.
5. Add it to `analyse()` in `report.ts` as a real stage, with a real count.
6. Render it. Reuse `ExplanationBlock`, `StateBadge` and the interval charts.
7. Add it to the exports and to `docs/methodology.md`.

---

## Changing the palette

`src/ui/tokens.test.ts` re-derives every contrast ratio from `src/index.css`
and fails the build if one drops below WCAG AA, in either theme, against any
surface a foreground can sit on.

It also enforces the constraint that shaped the design: five hues that all
clear AA against both a near-black and a near-white stack cannot also be
separated by luminance, so any two states within 1.12:1 of each other must
carry different glyphs. If you change a colour and that test fails, the fix is
usually a glyph rather than a hue.

---

## Changing the demo register

Do not edit `fixtures/demo-register.csv` or
`src/demo-register.generated.ts` by hand. Both are generated:

```bash
node scripts/make-demo.ts
```

`npm run verify` regenerates and compares, so a hand edit becomes a CI failure
rather than a quiet divergence between the demo and its generator.

The generator's comments explain the *mechanism* behind each property the demo
demonstrates — the assessor biases, the per-instance estimate spread, the
injected defects. If you add a property, add the mechanism, not a magic row.

---

## Changing a number in the documentation

Numbers about the demo register are checked:

```bash
node scripts/docs-numbers.ts          # what the engine currently says
node scripts/docs-numbers.ts --check  # fail if the README disagrees
```

They are written as `<!-- n:key -->value<!-- /n -->` markers so the check
matches a specific claim rather than any occurrence of a digit. If you add a
claim, add the key.

---

## Style

- British English in prose, in code comments, and in the interface.
- Comments explain *why*, and are worth writing at length where the reasoning
  is not obvious from the code. Several modules in `src/engine` open with a
  paragraph of argument; that is deliberate.
- `any` is banned. An unavoidable cast is `unknown`, narrowed.
- No `enum`, no `namespace`, no constructor parameter properties — the CLI runs
  these sources under type stripping, which cannot emit them.
- Prefer a named constant in `limits.ts` over a literal in a loop.

---

## Commits and pull requests

One change per pull request. In the description, say what claim the change
affects and how you checked it.

If you found a bug, a test that fails before your fix and passes after it is
worth more than the fix. Three of the tests in this repository exist because
writing them found a real defect — the `.txt`-holding-JSON detector, the
negative numbers corrupted by the formula-injection escape, and the palette's
green/amber luminance collision. They are described in
[CHANGELOG.md](CHANGELOG.md).

---

## What this project is not looking for

- A full FAIR implementation. PARALLAX is a measurement audit and a
  quantification triage, and keeping it that size is what makes it honest.
- A risk score. Reducing the three confidence numbers to one would be the exact
  operation the product spends eight views objecting to.
- Integrations that send a register anywhere.
