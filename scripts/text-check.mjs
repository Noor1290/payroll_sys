// Text check: has any text the user sees changed?
//   node scripts/text-check.mjs [base-commit]      (default base: 03a41db, the last pre-redesign commit)
//
// Renders every screen and dialog with fake data for two versions of the app -
// the base commit and the working tree - records all visible text, tooltips,
// screen-reader labels, placeholders and alert messages, and prints every
// difference, screen by screen. Exits with code 1 if there is any difference
// that is not listed in tests/textCheck/approved.json.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const base = process.argv[2] ?? '03a41db'
const root = path.resolve(import.meta.dirname, '..')
const work = path.join(root, '.text-check')
const baseTree = path.join(work, 'base')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function collect(label, srcDir) {
  const out = path.join(work, `${label}.json`)
  const outEmbedded = path.join(work, `${label}-embedded.json`)
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.textcheck.config.js'], {
    cwd: root,
    env: { ...process.env, TEXT_CHECK_SRC: srcDir, TEXT_CHECK_OUT: out, TEXT_CHECK_OUT_EMBEDDED: outEmbedded },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    console.error(result.stdout.split('\n').slice(-60).join('\n'))
    console.error(result.stderr.split('\n').slice(-20).join('\n'))
    throw new Error(`Collecting text for "${label}" failed.`)
  }
  return { ...JSON.parse(fs.readFileSync(out, 'utf8')), ...JSON.parse(fs.readFileSync(outEmbedded, 'utf8')) }
}

function counts(list) {
  const m = new Map()
  for (const s of list) m.set(s, (m.get(s) ?? 0) + 1)
  return m
}

fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
try {
  git('worktree', 'prune')
  // The base version's src/ lives inside the project so it resolves the same node_modules.
  git('worktree', 'add', '--detach', baseTree, base)

  const before = collect('base', path.join(baseTree, 'src'))
  const after = collect('current', path.join(root, 'src'))

  const approvedFile = path.join(root, 'tests/textCheck/approved.json')
  const approved = fs.existsSync(approvedFile) ? JSON.parse(fs.readFileSync(approvedFile, 'utf8')) : { added: [], removed: [] }
  const isApproved = (kind, s) => approved[kind].some((a) => a.text === s)

  const summary = { added: new Map(), removed: new Map() }
  const perScreen = []
  for (const screen of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = counts(before[screen] ?? [])
    const a = counts(after[screen] ?? [])
    const added = []
    const removed = []
    for (const s of new Set([...b.keys(), ...a.keys()])) {
      const d = (a.get(s) ?? 0) - (b.get(s) ?? 0)
      if (d > 0) added.push(s)
      if (d < 0) removed.push(s)
    }
    for (const s of added) summary.added.set(s, [...(summary.added.get(s) ?? []), screen])
    for (const s of removed) summary.removed.set(s, [...(summary.removed.get(s) ?? []), screen])
    if (added.length || removed.length) perScreen.push({ screen, added, removed })
  }

  const screens = Object.keys(after).length
  const strings = Object.values(after).reduce((n, l) => n + l.length, 0)
  console.log(`Text check: ${base} vs working tree. ${screens} screens and dialogs, ${strings} strings recorded.`)
  console.log(`Screens with any difference: ${perScreen.length}\n`)

  let unapproved = 0
  for (const kind of ['added', 'removed']) {
    console.log(kind === 'added' ? 'ADDED (in the working tree, not in the base):' : 'REMOVED (in the base, not in the working tree):')
    const entries = [...summary[kind].entries()].sort()
    if (entries.length === 0) console.log('  none')
    for (const [s, where] of entries) {
      const ok = isApproved(kind, s)
      if (!ok) unapproved++
      const reason = ok ? approved[kind].find((a) => a.text === s).why : 'NOT APPROVED'
      console.log(`  [${ok ? 'approved' : 'CHECK'}] ${s}`)
      console.log(`        ${reason} | seen on ${where.length} screen${where.length === 1 ? '' : 's'}, e.g. ${where[0]}`)
    }
    console.log('')
  }
  console.log(unapproved === 0 ? 'Every difference is on the approved list.' : `${unapproved} difference(s) are NOT on the approved list.`)

  // Form controls with no accessible name, in the working tree and (for comparison) the base.
  const unlabelled = (label) => JSON.parse(fs.readFileSync(path.join(work, `${label}.unlabelled.json`), 'utf8'))
  const now = unlabelled('current')
  console.log(`\nForm controls with no accessible name: ${now.length} (base commit: ${unlabelled('base').length})`)
  for (const u of now) console.log(`  ${u}`)
  if (now.length) unapproved++
  fs.writeFileSync(path.join(work, 'differences.json'), JSON.stringify(perScreen, null, 2))
  process.exitCode = unapproved === 0 ? 0 : 1
} finally {
  try {
    git('worktree', 'remove', '--force', baseTree)
  } catch {
    // Left behind only if the worktree was never created.
  }
}
