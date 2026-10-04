import fs from 'node:fs'
import path from 'node:path'
import { expect } from 'vitest'

const EXPECTED_DIR = path.resolve(import.meta.dirname, 'expected')

// JSON can't hold NaN/Infinity (they'd silently become null), so spell them out.
function replacer(_key, value) {
  if (typeof value === 'number' && !Number.isFinite(value)) return `<${String(value)}>`
  return value
}

// Compares `actual` against the recorded file as exact text, so values, field
// names and key order all have to match. The recorded files are only ever
// (re)written by `npm run test:record` - a normal run never changes them.
export function expectRecorded(name, actual) {
  const file = path.join(EXPECTED_DIR, `${name}.json`)
  const text = `${JSON.stringify(actual, replacer, 2)}\n`

  if (import.meta.env.MODE === 'record') {
    fs.mkdirSync(EXPECTED_DIR, { recursive: true })
    fs.writeFileSync(file, text)
    return
  }

  expect(fs.existsSync(file), `No recorded result for "${name}". Run "npm run test:record" on known-good code first.`).toBe(true)
  expect(text).toBe(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
}
