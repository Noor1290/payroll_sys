// @vitest-environment jsdom

// TODO C18 (rehearsal L1): renaming an identity field keeps its key ("NIC" kept the key
// "surname"), and nothing said so. The form now says it while the name differs and the key
// does not. TEST data only.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import IdentityFieldFormModal from '../../src/components/IdentityFieldFormModal'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root
let container
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  container?.remove()
  root = container = null
})
async function open(initial) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onSave = vi.fn()
  await act(async () => root.render(<IdentityFieldFormModal initial={initial} existingKeys={[]} onSave={onSave} onClose={vi.fn()} />))
  return onSave
}
function type(label, value) {
  const field = document.querySelector(`input[aria-label="${label}"]`)
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, value)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}
const note = () => document.querySelector('[data-testid="key-kept"]')

test('renamed, the field says it keeps its key; with the key changed too, or the name back, it says nothing', async () => {
  const onSave = await open({ id: 'f2', name: 'Surname', key: 'surname' })
  expect(note()).toBeNull()
  await act(async () => type('Name', 'NIC'))
  expect(note().textContent).toBe(
    'Renaming keeps the key “surname”, so the saved values stay where they are. Change the key too only if you want it to match the new name.'
  )
  await act(async () => type('Key', 'nic'))
  expect(note()).toBeNull()
  await act(async () => type('Key', 'surname'))
  await act(async () => type('Name', 'Surname'))
  expect(note()).toBeNull()
  // Saving a rename keeps the key, as before.
  await act(async () => type('Name', 'NIC'))
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save').click())
  expect(onSave).toHaveBeenCalledWith({ id: 'f2', name: 'NIC', key: 'surname' })
})

test('a new field says nothing about its key', async () => {
  await open(undefined)
  await act(async () => type('Name', 'Employee Code'))
  expect(note()).toBeNull()
})
