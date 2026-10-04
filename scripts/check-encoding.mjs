// Encoding check, run before every commit on the redesign branch:
//   node scripts/check-encoding.mjs [base-commit]      (default base: 03a41db)
//
// Looks at every file changed since the base commit (committed, staged, unstaged
// and untracked) and reports:
//   1. mojibake: text that was saved in the wrong encoding, e.g. "→" turned into
//      the three characters U+00E2 U+2020 U+2019;
//   2. every changed line where the non-ASCII characters themselves changed
//      (added, removed or replaced), so each one can be reviewed.
// Exits with code 1 if any mojibake is found.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const base = process.argv[2] ?? '03a41db'
const git = (...args) =>
  execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

const TEXT_FILE = /\.(jsx?|mjs|css|html|md|json|ya?ml|svg|txt)$/i
// hub_docs/ holds reference copies from the Payroll Hub repo; they are never committed here.
const SKIP = /^(package-lock\.json|node_modules\/|dist\/|hub_docs\/)/

// UTF-8 bytes misread as Windows-1252/Latin-1 always start with one of these
// (U+00C2..U+00F4) followed by a character from the 0x80-0xBF byte range as
// those code pages render it; plus the replacement character and its own mojibake.
const SECOND = '[\\u0080-\\u00BF\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178]'
const MOJIBAKE = new RegExp(`[\\u00C2-\\u00F4]${SECOND}|\\uFFFD|\\u00EF\\u00BF\\u00BD`)
const NON_ASCII = /[^\x00-\x7F]/g

const changed = new Set([
  ...git('diff', '--name-only', base).split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
])
const files = [...changed].filter((f) => f && TEXT_FILE.test(f) && !SKIP.test(f) && fs.existsSync(f)).sort()

const mojibake = []
const nonAsciiChanges = []

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  text.split('\n').forEach((line, i) => {
    if (MOJIBAKE.test(line)) mojibake.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`)
  })

  let oldText = ''
  try {
    oldText = git('show', `${base}:${file}`)
  } catch {
    // New file: every non-ASCII line in it counts as added.
  }
  const count = (s) => {
    const m = new Map()
    for (const ch of s.match(NON_ASCII) ?? []) m.set(ch, (m.get(ch) ?? 0) + 1)
    return m
  }
  const before = count(oldText)
  const after = count(text)
  const delta = []
  for (const ch of new Set([...before.keys(), ...after.keys()])) {
    const d = (after.get(ch) ?? 0) - (before.get(ch) ?? 0)
    if (d !== 0) delta.push(`${JSON.stringify(ch)} U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${d > 0 ? '+' : ''}${d}`)
  }
  if (delta.length) {
    nonAsciiChanges.push(`${file}: ${delta.join(', ')}`)
    // The changed lines that carry those characters, for review.
    const chars = new Set(delta.map((d) => JSON.parse(d.split(' U+')[0])))
    const hasChar = (line) => [...line].some((ch) => chars.has(ch))
    const diffLines = oldText
      ? git('diff', '-U0', base, '--', file).split('\n').filter((l) => /^[+-][^+-]/.test(l) && hasChar(l))
      : text.split('\n').filter(hasChar).map((l) => `+${l}`)
    for (const l of diffLines) nonAsciiChanges.push(`      ${l[0]} ${l.slice(1).trim().slice(0, 130)}`)
  }
}

console.log(`Encoding check against ${base}: ${files.length} changed text files scanned.`)
console.log(`\nMojibake found: ${mojibake.length}`)
for (const m of mojibake) console.log(`  ${m}`)
console.log(`\nFiles where the set of non-ASCII characters changed: ${nonAsciiChanges.filter((c) => !c.startsWith(' ')).length}`)
for (const c of nonAsciiChanges) console.log(`  ${c}`)

process.exit(mojibake.length ? 1 : 0)
