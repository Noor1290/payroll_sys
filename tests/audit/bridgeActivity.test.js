// The copy of the dashboard's bridge in this app (src/payrollHubBridge.js):
// while someone works in the app inside the dashboard, it says so, so the
// dashboard neither signs them out nor locks for "doing nothing". Run here
// against a fake window, as it would run inside the dashboard's frame.

import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const BRIDGE = path.resolve(import.meta.dirname, '../../src/payrollHubBridge.js')
const HUB_COPY = path.resolve(import.meta.dirname, '../../../payroll_hub/docs/bridge.js')
const HUB_ORIGIN = 'https://noor1290.github.io'
const source = fs.readFileSync(BRIDGE, 'utf8')

function load({ embedded }) {
  const posted = []
  const listeners = new Map()
  const fake = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    crypto: { randomUUID: () => crypto.randomUUID() },
  }
  fake.parent = embedded ? { postMessage: (message, targetOrigin) => posted.push({ message, targetOrigin, at: Date.now() }) } : fake
  new Function('window', source)(fake)
  fake.PayrollHubBridge.init({ appId: 'payroll' })
  return {
    activity: () => posted.filter((p) => p.message.type === 'activity'),
    posted,
    listeners,
    // What a person does in the app.
    act: (type) => listeners.get(type)?.({ type }),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-13T09:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('inside the dashboard', () => {
  test('a click, a key, the wheel or a touch in the app is reported to the dashboard, with nothing in it', () => {
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      const app = load({ embedded: true })
      expect(app.activity()).toHaveLength(0)

      app.act(event)

      expect(app.activity(), event).toHaveLength(1)
      const { message, targetOrigin } = app.activity()[0]
      expect(message).toMatchObject({ type: 'activity', from: 'payroll', to: 'dashboard', version: 1, payload: {} })
      // Only ever to the dashboard's exact address, never "*".
      expect(targetOrigin).toBe(HUB_ORIGIN)
    }
  })

  test('typing all the time sends one message every 30 seconds, not one per key', () => {
    const app = load({ embedded: true })
    const start = Date.now()

    // Five minutes of typing, four keys a second.
    for (let ms = 0; ms < 5 * 60_000; ms += 250) {
      app.act('keydown')
      vi.advanceTimersByTime(250)
    }

    expect(app.activity().map((p) => (p.at - start) / 1000)).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300])
  })

  test('nothing is sent while nobody touches the app', () => {
    const app = load({ embedded: true })
    app.act('keydown')
    vi.advanceTimersByTime(60 * 60_000)
    expect(app.activity()).toHaveLength(1)
  })

  test('no payroll value, key or text is ever in the message: it says only that something was done', () => {
    const app = load({ embedded: true })
    app.listeners.get('keydown')({ type: 'keydown', key: '7', target: { value: '18115.00' } })
    expect(JSON.stringify(app.activity()[0].message.payload)).toBe('{}')
    expect(Object.keys(app.activity()[0].message).sort()).toEqual(['from', 'id', 'payload', 'to', 'type', 'version'])
  })
})

describe('opened on its own', () => {
  test('it listens for nothing and posts nothing', () => {
    const app = load({ embedded: false })
    app.act('keydown')
    vi.advanceTimersByTime(60_000)
    expect([...app.listeners.keys()]).toEqual([])
    expect(app.posted).toEqual([])
  })
})

describe('the copy', () => {
  // Only where the dashboard's folder sits next to this one (as on the development machine).
  test.skipIf(!fs.existsSync(HUB_COPY))('is the dashboard\'s docs/bridge.js, unchanged', () => {
    const normalise = (text) => text.replace(/\r\n/g, '\n')
    expect(normalise(source)).toBe(normalise(fs.readFileSync(HUB_COPY, 'utf8')))
  })
})
