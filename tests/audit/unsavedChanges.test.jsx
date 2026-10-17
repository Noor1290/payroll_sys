// @vitest-environment jsdom

// Rehearsal fix F1 (17 Oct 2026, problem H3): inside the dashboard, this app tells it whether a
// change is not saved there yet ("Saving…" or "NOT saved" in the dashboard bar), so the
// dashboard asks before it reloads the app on a change of company. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import DashboardBar from '../../src/components/DashboardBar'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
  delete window.PayrollHubBridge
})

const months = (state) => ({ supported: true, state, problem: state === 'not-saved' ? { code: 'locked', period: '2026-09' } : null })

test('the dashboard is told "unsaved" while a month is saving or NOT saved, and "saved" once it is', async () => {
  const setUnsaved = vi.fn()
  window.PayrollHubBridge = { isEmbedded: () => true, setUnsaved }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const bar = (state) => <DashboardBar company={{ label: 'TEST Co A' }} access={null} onReload={() => {}} months={months(state)} />

  await act(async () => root.render(bar('saved')))
  expect(setUnsaved.mock.calls).toEqual([[false]])

  await act(async () => root.render(bar('saving')))
  await act(async () => root.render(bar('not-saved')))
  expect(container.textContent).toContain('NOT saved')
  await act(async () => root.render(bar('saved')))
  expect(setUnsaved.mock.calls).toEqual([[false], [true], [true], [false]])
})

test('an older bridge without setUnsaved changes nothing', async () => {
  window.PayrollHubBridge = { isEmbedded: () => true }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<DashboardBar company={{ label: 'TEST Co A' }} access={null} onReload={() => {}} months={months('not-saved')} />))
  expect(container.textContent).toContain('NOT saved')
})
