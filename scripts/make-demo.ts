/**
 * Generates the demo risk register.
 *
 * The register is synthetic. No real organisation's risks, owners or estimates
 * appear in it, and none of the business units exist. It is written to be
 * *representative* rather than convenient: the scenarios, the scoring habits
 * and the defects are the ones the author has actually met in corporate
 * registers, including the boring ones — four rows with no assessor, a
 * duplicate reference, a date somebody typed as "Q2".
 *
 * It is generated rather than hand-written for two reasons. It has to be
 * deterministic, so that the numbers quoted in the README can be checked by CI
 * (`node scripts/make-demo.ts --check`). And it has to *contain* the things
 * the product claims to find — a cell whose estimated members differ by
 * fortyfold, a confirmed inversion between a score-16 risk and a score-9 one,
 * two assessors a level apart on comparable risks — without those being
 * dropped in as magic rows. Each one is produced by a stated mechanism below,
 * and the mechanism is the point: it is how registers actually acquire these
 * properties.
 *
 *   node scripts/make-demo.ts          write the register
 *   node scripts/make-demo.ts --check  fail if it differs from what is committed
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toCsv } from '../src/engine/csv.ts'
import { createRng } from '../src/engine/rng.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/* -------------------------------------------------------------------------- */
/* Cast                                                                       */
/* -------------------------------------------------------------------------- */

const UNITS = [
  'Retail Banking',
  'Payments',
  'Platform Engineering',
  'Data Platform',
  'Corporate IT',
  'Customer Operations',
  'Digital Channels',
  'Group Security',
] as const

type Unit = (typeof UNITS)[number]

/**
 * Every unit must have an assessor, or a whole business unit would silently be
 * generated with a blank one and the calibration analysis would be quietly
 * describing a smaller register than the file does.
 */
function assertUnitsCovered(map: Record<Unit, string>): void {
  const missing = UNITS.filter((unit) => !map[unit])
  if (missing.length > 0) throw new Error(`No assessor for: ${missing.join(", ")}`)
}

/**
 * Assessors, with the scoring habit each one is generated with.
 *
 * The biases are the mechanism by which the calibration finding exists. They
 * are applied to the *level*, before clamping, so a risk whose true position
 * is already at the top of the scale absorbs the bias rather than showing it —
 * which is exactly why an analysis that looked only at raw level averages
 * would understate the offset, and why the real one compares medians within
 * peer groups instead.
 */
const ASSESSORS: readonly {
  name: string
  unit: Unit
  likelihoodBias: number
  impactBias: number
}[] = [
  { name: 'A. Okafor', unit: 'Group Security', likelihoodBias: 1, impactBias: 0 },
  { name: 'J. Lindqvist', unit: 'Platform Engineering', likelihoodBias: -1, impactBias: 0 },
  { name: 'M. Reyes', unit: 'Payments', likelihoodBias: 0, impactBias: 0 },
  { name: 'S. Banerjee', unit: 'Retail Banking', likelihoodBias: 0, impactBias: 0 },
  { name: 'T. Novak', unit: 'Data Platform', likelihoodBias: 0, impactBias: 1 },
  { name: 'R. Delacroix', unit: 'Customer Operations', likelihoodBias: 0, impactBias: 0 },
]

const UNIT_ASSESSOR: Record<Unit, string> = {
  'Retail Banking': 'S. Banerjee',
  Payments: 'M. Reyes',
  'Platform Engineering': 'J. Lindqvist',
  'Data Platform': 'T. Novak',
  'Corporate IT': 'R. Delacroix',
  'Customer Operations': 'R. Delacroix',
  'Digital Channels': 'S. Banerjee',
  'Group Security': 'A. Okafor',
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                  */
/* -------------------------------------------------------------------------- */

interface Scenario {
  readonly title: string
  readonly category: string
  readonly description: string
  readonly controls: string
  readonly treatment: string
  /** Base levels, before assessor bias and jitter. */
  readonly l: number
  readonly i: number
  readonly units: readonly Unit[]
  /**
   * A 90% interval the organisation recorded for this scenario, where it
   * recorded one. About a quarter of the register has these, which is roughly
   * what a register looks like a year after somebody starts asking for them.
   */
  readonly frequency?: readonly [number, number]
  readonly magnitude?: readonly [number, number]
}

const SCENARIOS: readonly Scenario[] = [
  /* --- Ransomware ------------------------------------------------------- */
  {
    title: 'Ransomware encrypts a production file estate',
    category: 'Ransomware',
    description:
      'An operator gains domain privilege from an unpatched edge device and encrypts shared storage across the estate.',
    controls: 'EDR on servers; offline backups tested quarterly; network segmentation between zones.',
    treatment: 'Mitigate',
    l: 2,
    i: 5,
    units: ['Corporate IT', 'Retail Banking', 'Platform Engineering', 'Payments', 'Digital Channels'],
    frequency: [0.02, 0.12],
    magnitude: [1_800_000, 14_000_000],
  },
  {
    title: 'Ransomware in a managed service provider reaches our tenancy',
    category: 'Ransomware',
    description: 'A provider with standing access is compromised and the intrusion follows the trust path inward.',
    controls: 'Provider access reviewed annually; no standing admin on production.',
    treatment: 'Mitigate',
    l: 2,
    i: 4,
    units: ['Corporate IT', 'Customer Operations', 'Retail Banking', 'Digital Channels'],
  },
  {
    title: 'Backup repository encrypted alongside primary storage',
    category: 'Ransomware',
    description: 'Backups reachable from the same identity plane as the systems they protect.',
    controls: 'Immutable snapshots on the primary tier only.',
    treatment: 'Mitigate',
    l: 2,
    i: 5,
    units: ['Platform Engineering', 'Data Platform', 'Corporate IT'],
  },

  /* --- Identity & access ------------------------------------------------ */
  {
    title: 'Privileged identity compromise in the cloud control plane',
    category: 'Identity & access',
    description:
      'A long-lived administrative principal is used from an unrecognised location and creates further principals.',
    controls: 'Hardware MFA for admins; 90-day credential rotation; break-glass audited.',
    treatment: 'Mitigate',
    l: 3,
    i: 5,
    units: ['Platform Engineering', 'Group Security', 'Data Platform', 'Payments', 'Corporate IT'],
    frequency: [0.08, 0.5],
    magnitude: [900_000, 7_000_000],
  },
  {
    title: 'Joiner-mover-leaver failure leaves access after departure',
    category: 'Identity & access',
    description: 'Access is not revoked on departure because the leaver process depends on a manual ticket.',
    controls: 'Quarterly access recertification.',
    treatment: 'Mitigate',
    l: 4,
    i: 2,
    units: ['Corporate IT', 'Customer Operations', 'Retail Banking', 'Digital Channels', 'Payments', 'Data Platform'],
    frequency: [2, 9],
    magnitude: [4_000, 45_000],
  },
  {
    title: 'Federated single sign-on trust misconfiguration',
    category: 'Identity & access',
    description: 'A relying party accepts assertions from an issuer that should not be trusted for it.',
    controls: 'Change review on federation metadata.',
    treatment: 'Mitigate',
    l: 2,
    i: 4,
    units: ['Digital Channels', 'Group Security', 'Corporate IT', 'Retail Banking'],
  },
  {
    title: 'Service account with no owner retains production write access',
    category: 'Identity & access',
    description: 'An account created for a migration is still live and is not attributable to anyone.',
    controls: 'None recorded.',
    treatment: 'Mitigate',
    l: 4,
    i: 3,
    units: ['Platform Engineering', 'Data Platform', 'Corporate IT', 'Digital Channels', 'Payments'],
  },

  /* --- Cloud configuration ---------------------------------------------- */
  {
    title: 'Object storage bucket exposed to the public internet',
    category: 'Cloud configuration',
    description: 'A bucket policy is widened during an incident and not narrowed afterwards.',
    controls: 'Preventive policy in two of five accounts; daily posture scan.',
    treatment: 'Mitigate',
    l: 3,
    i: 4,
    units: ['Data Platform', 'Platform Engineering', 'Digital Channels', 'Customer Operations'],
    frequency: [0.4, 2.5],
    magnitude: [40_000, 600_000],
  },
  {
    title: 'Security group opens a database port to the whole internet',
    category: 'Cloud configuration',
    description: 'A troubleshooting rule is applied directly in the console and outlives its purpose.',
    controls: 'Drift detection on the production account only.',
    treatment: 'Mitigate',
    l: 3,
    i: 4,
    units: ['Platform Engineering', 'Data Platform', 'Digital Channels', 'Corporate IT'],
  },
  {
    title: 'Infrastructure-as-code pipeline deploys an unreviewed module',
    category: 'Cloud configuration',
    description: 'A third-party module version is pinned by tag rather than digest and the tag moves.',
    controls: 'Plan review on production changes.',
    treatment: 'Mitigate',
    l: 3,
    i: 3,
    units: ['Platform Engineering', 'Digital Channels', 'Data Platform'],
  },
  {
    title: 'Key management policy permits decryption from outside the workload',
    category: 'Cloud configuration',
    description: 'A key policy grants decrypt to a role reachable from a lower-trust account.',
    controls: 'Annual key policy review.',
    treatment: 'Mitigate',
    l: 2,
    i: 4,
    units: ['Data Platform', 'Group Security', 'Platform Engineering'],
  },

  /* --- Data exfiltration ------------------------------------------------ */
  {
    title: 'Bulk customer record extraction through a reporting interface',
    category: 'Data exfiltration',
    description:
      'A reporting endpoint permits unbounded exports and is used at a rate no human workflow requires.',
    controls: 'Rate limits on the public API; no limit on the internal reporting path.',
    treatment: 'Mitigate',
    l: 3,
    i: 4,
    units: ['Data Platform', 'Customer Operations', 'Retail Banking', 'Digital Channels'],
    frequency: [0.3, 1.8],
    magnitude: [250_000, 2_400_000],
  },
  {
    title: 'Regulated data copied into a non-production environment',
    category: 'Data exfiltration',
    description: 'Production data is used to reproduce a defect and is not removed afterwards.',
    controls: 'Masking available but optional.',
    treatment: 'Mitigate',
    l: 4,
    i: 3,
    units: ['Data Platform', 'Platform Engineering', 'Digital Channels', 'Retail Banking'],
    frequency: [3, 12],
    magnitude: [15_000, 120_000],
  },
  {
    title: 'Departing employee takes a customer list',
    category: 'Data exfiltration',
    description: 'A sales contact export is taken in the notice period.',
    controls: 'DLP alerting on email; no control on personal cloud storage.',
    treatment: 'Mitigate',
    l: 4,
    i: 2,
    units: ['Retail Banking', 'Customer Operations'],
  },

  /* --- Third party ------------------------------------------------------ */
  {
    title: 'Critical supplier suffers a breach affecting shared data',
    category: 'Third party',
    description: 'A processor holding customer records is compromised.',
    controls: 'Contractual notification within 24 hours; annual assurance questionnaire.',
    treatment: 'Transfer',
    l: 3,
    i: 4,
    units: ['Customer Operations', 'Retail Banking', 'Group Security', 'Payments', 'Digital Channels'],
    frequency: [0.5, 2.2],
    magnitude: [120_000, 1_600_000],
  },
  {
    title: 'Software supply chain compromise in a build dependency',
    category: 'Third party',
    description: 'A transitive dependency ships a malicious version that reaches the build.',
    controls: 'Lockfiles; no provenance verification.',
    treatment: 'Mitigate',
    l: 2,
    i: 4,
    units: ['Platform Engineering', 'Digital Channels'],
  },
  {
    title: 'Single-source provider fails with no contracted alternative',
    category: 'Third party',
    description: 'A niche provider in the payment path has no substitute inside the notice period.',
    controls: 'None recorded.',
    treatment: 'Accept',
    l: 2,
    i: 4,
    units: ['Payments'],
  },
  {
    title: 'Offshore support centre loses access to case systems',
    category: 'Third party',
    description: 'A provider outage removes the ability to service customers for a working day.',
    controls: 'Second site contracted but untested.',
    treatment: 'Mitigate',
    l: 3,
    i: 2,
    units: ['Customer Operations'],
  },

  /* --- API abuse -------------------------------------------------------- */
  {
    title: 'Credential stuffing against the payments API edge',
    category: 'API abuse',
    description:
      'Lists from unrelated breaches are replayed against the login path at a rate the edge absorbs.',
    controls: 'Velocity limits; bot scoring in monitor mode only.',
    treatment: 'Mitigate',
    l: 3,
    i: 3,
    units: ['Payments', 'Digital Channels', 'Retail Banking'],
    // The lower half of the register's most instructive inversion: scored 9,
    // happens several times a year, and each time costs six figures.
    frequency: [2, 6],
    magnitude: [80_000, 240_000],
  },
  {
    title: 'Enumeration of account identifiers through a public endpoint',
    category: 'API abuse',
    description: 'Response differences allow valid identifiers to be discovered at scale.',
    controls: 'Uniform error responses on two of six endpoints.',
    treatment: 'Mitigate',
    l: 4,
    i: 2,
    units: ['Digital Channels', 'Payments'],
  },
  {
    title: 'Business logic abuse of a refund workflow',
    category: 'API abuse',
    description: 'A sequence of legitimate calls produces a refund without a matching debit.',
    controls: 'Reconciliation daily; no preventive control.',
    treatment: 'Mitigate',
    l: 3,
    i: 3,
    units: ['Payments', 'Retail Banking'],
    frequency: [1.5, 5],
    magnitude: [30_000, 180_000],
  },

  /* --- Credential compromise -------------------------------------------- */
  {
    title: 'Phishing yields a corporate mailbox',
    category: 'Credential compromise',
    description: 'A consent-phishing page yields a session token for a staff mailbox.',
    controls: 'Conditional access; phishing simulation quarterly.',
    treatment: 'Mitigate',
    l: 5,
    i: 2,
    units: ['Corporate IT', 'Retail Banking', 'Customer Operations', 'Digital Channels', 'Payments', 'Platform Engineering', 'Group Security', 'Data Platform'],
    frequency: [6, 30],
    magnitude: [3_000, 40_000],
  },
  {
    title: 'Developer credential leaked in a public repository',
    category: 'Credential compromise',
    description: 'A token is committed to a public repository and used before rotation.',
    controls: 'Secret scanning on push for the main organisation only.',
    treatment: 'Mitigate',
    l: 4,
    i: 3,
    units: ['Platform Engineering', 'Digital Channels'],
    frequency: [1.5, 6],
    magnitude: [20_000, 300_000],
  },
  {
    title: 'Session token theft through an unpatched browser extension',
    category: 'Credential compromise',
    description: 'An extension with broad permissions exfiltrates session cookies.',
    controls: 'Extension allowlist on managed devices.',
    treatment: 'Mitigate',
    l: 3,
    i: 3,
    units: ['Corporate IT'],
  },

  /* --- Availability ----------------------------------------------------- */
  {
    title: 'Regional cloud outage removes the primary payment path',
    category: 'Availability',
    description: 'A provider region becomes unavailable for several hours during a peak window.',
    controls: 'Multi-zone within one region; cross-region failover untested.',
    treatment: 'Mitigate',
    l: 2,
    i: 4,
    units: ['Payments', 'Platform Engineering'],
    frequency: [0.15, 0.8],
    magnitude: [400_000, 3_200_000],
  },
  {
    title: 'Certificate expiry takes a customer-facing service offline',
    category: 'Availability',
    description: 'A certificate outside the automated renewal path expires.',
    controls: 'Automated renewal for 80% of endpoints; alerting at 14 days.',
    treatment: 'Mitigate',
    l: 4,
    i: 2,
    units: ['Digital Channels', 'Platform Engineering', 'Corporate IT', 'Payments', 'Data Platform'],
    frequency: [1, 4],
    magnitude: [12_000, 90_000],
  },
  {
    title: 'Volumetric denial of service against the public edge',
    category: 'Availability',
    description: 'Sustained traffic exceeds the contracted scrubbing capacity.',
    controls: 'Provider scrubbing to a contracted ceiling.',
    treatment: 'Transfer',
    l: 3,
    i: 3,
    units: ['Digital Channels', 'Payments'],
  },
  {
    title: 'Change to a shared platform component halts batch settlement',
    category: 'Availability',
    description: 'A library upgrade changes behaviour under load and the overnight run does not complete.',
    controls: 'Staged rollout; rollback tested.',
    treatment: 'Mitigate',
    l: 3,
    i: 3,
    units: ['Payments', 'Platform Engineering'],
  },

  /* --- Insider ---------------------------------------------------------- */
  {
    title: 'Privileged insider alters transaction records',
    category: 'Insider',
    description: 'An administrator with database access modifies records and the change is not detectable.',
    controls: 'Privileged session recording in one environment.',
    treatment: 'Mitigate',
    l: 1,
    i: 5,
    units: ['Payments', 'Retail Banking', 'Group Security'],
  },
  {
    title: 'Support agent views records outside a service interaction',
    category: 'Insider',
    description: 'Case tooling permits broad search without a purpose being recorded.',
    controls: 'Post-hoc sampling of 1% of searches.',
    treatment: 'Mitigate',
    l: 4,
    i: 2,
    units: ['Customer Operations', 'Retail Banking'],
    frequency: [4, 20],
    magnitude: [2_000, 30_000],
  },

  /* --- Payment fraud ---------------------------------------------------- */
  {
    title: 'Authorised push payment fraud against retail customers',
    category: 'Payment fraud',
    description: 'Customers are induced to transfer funds to an account controlled by the fraudster.',
    controls: 'Confirmation of payee; behavioural warnings at initiation.',
    treatment: 'Mitigate',
    l: 5,
    i: 3,
    units: ['Retail Banking', 'Payments', 'Digital Channels'],
    frequency: [40, 160],
    magnitude: [3_500, 22_000],
  },
  {
    title: 'Merchant account takeover redirects settlement',
    category: 'Payment fraud',
    description: 'Settlement details are changed after a takeover of the merchant portal.',
    controls: 'Out-of-band confirmation on bank detail changes.',
    treatment: 'Mitigate',
    l: 3,
    i: 4,
    units: ['Payments'],
    frequency: [0.6, 3],
    magnitude: [180_000, 1_400_000],
  },
  {
    title: 'Internal payment approval control bypassed by a shared account',
    category: 'Payment fraud',
    description: 'Dual authorisation is defeated because two approvers share a credential.',
    controls: 'Segregation of duties policy; no technical enforcement.',
    treatment: 'Mitigate',
    l: 2,
    i: 4,
    units: ['Payments', 'Corporate IT'],
  },

  /* --- Regulatory ------------------------------------------------------- */
  {
    title: 'Regulatory penalty following a sustained control failure',
    category: 'Regulatory',
    description:
      'A control reported as effective is found to have been ineffective across a reporting period.',
    controls: 'Annual attestation; internal audit on a three-year cycle.',
    treatment: 'Mitigate',
    // The upper half of the inversion: scored 16 by a committee, but the team
    // that owns it estimates one occurrence every few decades.
    l: 4,
    i: 4,
    units: ['Group Security', 'Retail Banking'],
    frequency: [0.02, 0.08],
    magnitude: [300_000, 900_000],
  },
  {
    title: 'Breach notification deadline missed for a reportable incident',
    category: 'Regulatory',
    description: 'A 72-hour notification window is missed because severity is assessed late.',
    controls: 'Incident severity guide; on-call legal rota.',
    treatment: 'Mitigate',
    l: 3,
    i: 3,
    units: ['Group Security', 'Customer Operations'],
  },
  {
    title: 'Data transfer to a jurisdiction without an adequacy basis',
    category: 'Regulatory',
    description: 'A new processing location is adopted before the transfer basis is documented.',
    controls: 'Privacy review on new suppliers.',
    treatment: 'Mitigate',
    l: 2,
    i: 3,
    units: ['Data Platform', 'Customer Operations'],
  },

  /* --- Endpoint & network ----------------------------------------------- */
  {
    title: 'Unpatched internet-facing appliance exploited',
    category: 'Vulnerability management',
    description: 'A known exploited vulnerability in an edge appliance is not remediated inside the window.',
    controls: 'Monthly patch cycle; emergency process for known exploited vulnerabilities.',
    treatment: 'Mitigate',
    l: 3,
    i: 4,
    units: ['Platform Engineering', 'Corporate IT', 'Group Security'],
    frequency: [0.5, 2],
    magnitude: [200_000, 2_000_000],
  },
  {
    title: 'End-of-life operating system remains in the payment estate',
    category: 'Vulnerability management',
    description: 'A host that cannot be upgraded remains in scope for the card environment.',
    controls: 'Compensating network controls; annual exception.',
    treatment: 'Accept',
    l: 3,
    i: 4,
    units: ['Payments', 'Corporate IT'],
  },
  {
    title: 'Vulnerability remediation exceeds the agreed window',
    category: 'Vulnerability management',
    description: 'High-severity findings routinely remain open past the policy window.',
    controls: 'Monthly reporting to the risk committee.',
    treatment: 'Mitigate',
    l: 5,
    i: 2,
    units: ['Platform Engineering', 'Corporate IT', 'Digital Channels'],
    frequency: [8, 40],
    magnitude: [1_500, 25_000],
  },
  {
    title: 'Unmanaged device connects to an internal network segment',
    category: 'Vulnerability management',
    description: 'A contractor device joins a segment with access to internal services.',
    controls: 'Network access control in two of nine offices.',
    treatment: 'Mitigate',
    l: 4,
    i: 2,
    units: ['Corporate IT'],
  },

  /* --- Monitoring ------------------------------------------------------- */
  {
    title: 'Security telemetry gap in a critical estate',
    category: 'Detection & response',
    description: 'A platform emits no usable telemetry, so an intrusion there would not be seen.',
    controls: 'Log forwarding configured elsewhere.',
    treatment: 'Mitigate',
    l: 4,
    i: 3,
    units: ['Data Platform', 'Platform Engineering', 'Group Security'],
  },
  {
    title: 'Out-of-hours incident response depends on a single person',
    category: 'Detection & response',
    description: 'One named individual holds the knowledge to contain a major incident overnight.',
    controls: 'On-call rota; no documented runbook for the critical path.',
    treatment: 'Mitigate',
    l: 3,
    i: 3,
    units: ['Group Security', 'Platform Engineering'],
  },
  {
    title: 'Detection rules not maintained after a platform migration',
    category: 'Detection & response',
    description: 'Rules reference fields that no longer exist and fire on nothing.',
    controls: 'Quarterly rule review, last completed nine months ago.',
    treatment: 'Mitigate',
    l: 4,
    i: 3,
    units: ['Group Security'],
  },
]

/* -------------------------------------------------------------------------- */
/* Generation                                                                 */
/* -------------------------------------------------------------------------- */

const HEADER = [
  'Risk Ref',
  'Risk Title',
  'Description',
  'Likelihood Score',
  'Impact Score',
  'Risk Score',
  'Risk Category',
  'Risk Owner',
  'Business Unit',
  'Assessed By',
  'Assessment Date',
  'Response',
  'Existing Controls',
  'Freq Min (per yr)',
  'Freq Max (per yr)',
  'Loss Min (GBP)',
  'Loss Max (GBP)',
]

const OWNERS = [
  'Head of Technology Risk',
  'Chief Information Security Officer',
  'Director of Engineering',
  'Head of Payments Operations',
  'Data Protection Officer',
  'Head of Customer Operations',
  'Head of Infrastructure',
  'Group Head of Fraud',
]

function clampLevel(value: number): number {
  return Math.max(1, Math.min(5, Math.round(value)))
}

interface Row {
  ref: string
  title: string
  description: string
  likelihood: string
  impact: string
  score: string
  category: string
  owner: string
  unit: string
  assessor: string
  date: string
  treatment: string
  controls: string
  freqMin: string
  freqMax: string
  lossMin: string
  lossMax: string
}

function build(): Row[] {
  assertUnitsCovered(UNIT_ASSESSOR)
  const rng = createRng(0x50787631)
  const rows: Row[] = []
  let sequence = 1

  for (const scenario of SCENARIOS) {
    for (const unit of scenario.units) {
      // A quarter of rows are scored centrally rather than by the unit, which
      // is what gives the peer groups more than one assessor in them.
      const central = rng.next() < 0.28
      const assessorName = central ? 'A. Okafor' : UNIT_ASSESSOR[unit]
      const assessor = ASSESSORS.find((a) => a.name === assessorName)
      const jitterL = pick(rng, [-1, 0, 0, 0, 1])
      const jitterI = pick(rng, [0, 0, 0, 1])

      const likelihood = clampLevel(scenario.l + (assessor?.likelihoodBias ?? 0) + jitterL)
      const impact = clampLevel(scenario.i + (assessor?.impactBias ?? 0) + jitterI)

      // Per-instance variation on the recorded estimate, so two units running
      // the same scenario do not record identical numbers. The spread is the
      // second mechanism behind the compression findings: it is what makes two
      // rows in one cell provably different.
      const scale = 0.45 + rng.next() * 1.9
      const frequency = scenario.frequency
        ? ([scenario.frequency[0] * scale, scenario.frequency[1] * scale] as const)
        : undefined
      const magScale = 0.5 + rng.next() * 2.2
      const magnitude = scenario.magnitude
        ? ([scenario.magnitude[0] * magScale, scenario.magnitude[1] * magScale] as const)
        : undefined

      const ref = `RR-${String(sequence).padStart(3, '0')}`
      sequence += 1

      rows.push({
        ref,
        title: scenario.title,
        description: scenario.description,
        likelihood: String(likelihood),
        impact: String(impact),
        score: String(likelihood * impact),
        category: scenario.category,
        owner: OWNERS[Math.floor(rng.next() * OWNERS.length)] as string,
        unit,
        assessor: assessorName,
        date: isoDate(rng),
        treatment: scenario.treatment,
        controls: scenario.controls,
        freqMin: frequency ? sig(frequency[0]) : '',
        freqMax: frequency ? sig(frequency[1]) : '',
        lossMin: magnitude ? String(Math.round(magnitude[0] / 500) * 500) : '',
        lossMax: magnitude ? String(Math.round(magnitude[1] / 500) * 500) : '',
      })
    }
  }

  return injectDefects(rows)
}

/**
 * The defects.
 *
 * Every register has them, and a demo that does not is a demo of a product
 * nobody will recognise. They are applied at fixed positions so the counts on
 * the overview are reproducible, and each one exercises a different branch of
 * `validate.ts`.
 */
function injectDefects(rows: Row[]): Row[] {
  const at = (index: number): Row => rows[index] as Row

  // Three rows assessed for likelihood but never for impact.
  for (const index of [11, 46, 92]) at(index).impact = ''
  // One with no likelihood.
  at(63).likelihood = ''
  // Two scored on a scale that is not the configured one.
  at(27).likelihood = '7'
  at(74).likelihood = '6'
  // One with a level that is not a number at all.
  at(38).impact = 'N/A'
  // Four rows nobody signed.
  for (const index of [7, 33, 58, 101]) at(index).assessor = ''
  // Two dates a human typed.
  at(19).date = 'Q2 2025'
  at(84).date = '15th May'
  // A duplicate reference, which every register acquires eventually.
  at(52).ref = at(51).ref
  // A row whose title was never filled in.
  at(110).title = ''
  // Five rows whose score column is a residual score rather than the formula.
  for (const index of [4, 23, 44, 67, 88]) {
    const row = at(index)
    const l = Number(row.likelihood)
    const i = Number(row.impact)
    if (Number.isFinite(l) && Number.isFinite(i)) row.score = String(Math.max(1, Math.round(l * i * 0.6)))
  }
  // Two rows carrying an averaged score, which the formula cannot produce.
  for (const index of [15, 96]) {
    const row = at(index)
    const l = Number(row.likelihood)
    const i = Number(row.impact)
    if (Number.isFinite(l) && Number.isFinite(i)) row.score = (Math.round(l * i * 0.85 * 2) / 2).toFixed(1)
  }
  // One estimate with its bounds the wrong way round.
  const inverted = rows.find((r) => r.lossMin !== '' && r.ref !== at(52).ref)
  if (inverted) {
    const swap = inverted.lossMin
    inverted.lossMin = inverted.lossMax
    inverted.lossMax = swap
  }
  // One estimate with only a lower bound.
  const halfOpen = rows.filter((r) => r.freqMin !== '')[6]
  if (halfOpen) halfOpen.freqMax = ''

  return rows
}

function pick<T>(rng: { next(): number }, values: readonly T[]): T {
  return values[Math.floor(rng.next() * values.length)] as T
}

function isoDate(rng: { next(): number }): string {
  const month = 1 + Math.floor(rng.next() * 9)
  const day = 1 + Math.floor(rng.next() * 28)
  // A fifth of the register was typed by hand into a date field with no format.
  if (rng.next() < 0.2) return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/2025`
  return `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function sig(value: number): string {
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return String(Math.round(value * 10) / 10)
  return String(Number(value.toPrecision(2)))
}

/* -------------------------------------------------------------------------- */
/* Emission                                                                   */
/* -------------------------------------------------------------------------- */

function toRegisterCsv(rows: readonly Row[]): string {
  return toCsv(
    HEADER,
    rows.map((r) => [
      r.ref,
      r.title,
      r.description,
      r.likelihood,
      r.impact,
      r.score,
      r.category,
      r.owner,
      r.unit,
      r.assessor,
      r.date,
      r.treatment,
      r.controls,
      r.freqMin,
      r.freqMax,
      r.lossMin,
      r.lossMax,
    ]),
  )
}

function toModule(csv: string, rowCount: number): string {
  return `/**
 * The demo register, generated by \`scripts/make-demo.ts\`.
 *
 * Do not edit by hand. \`npm run verify\` regenerates it and fails if the
 * committed copy differs, so an edit here becomes a CI failure rather than a
 * quiet divergence between the demo and its generator.
 *
 * ${rowCount} synthetic rows. No real organisation, person or estimate appears in it.
 */

export const DEMO_REGISTER_NAME = 'Group technology risk register (synthetic)'
export const DEMO_REGISTER_FILE = 'demo-register.csv'
export const DEMO_REGISTER_ROWS = ${rowCount}
export const DEMO_REGISTER_CSV = ${JSON.stringify(csv)}
`
}

function main(): void {
  const check = process.argv.includes('--check')
  const rows = build()
  const csv = toRegisterCsv(rows)
  const module_ = toModule(csv, rows.length)

  const csvPath = join(root, 'fixtures', 'demo-register.csv')
  const modulePath = join(root, 'src', 'demo-register.generated.ts')

  if (check) {
    let failed = false
    for (const [path, expected] of [
      [csvPath, csv],
      [modulePath, module_],
    ] as const) {
      let actual: string
      try {
        actual = readFileSync(path, 'utf8')
      } catch {
        console.error(`missing: ${path}`)
        failed = true
        continue
      }
      if (actual !== expected) {
        console.error(`stale: ${path} differs from its generator. Run: node scripts/make-demo.ts`)
        failed = true
      }
    }
    if (failed) process.exit(1)
    console.log(`demo register up to date (${rows.length} rows)`)
    return
  }

  mkdirSync(dirname(csvPath), { recursive: true })
  writeFileSync(csvPath, csv, 'utf8')
  writeFileSync(modulePath, module_, 'utf8')
  console.log(`wrote ${rows.length} rows to fixtures/demo-register.csv and src/demo-register.generated.ts`)
}

main()
