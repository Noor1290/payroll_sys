// @vitest-environment jsdom

// Safety net, part 3: opened on its own (not inside the dashboard), the app
// must show no "Send to dashboard" button and post nothing.

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test } from 'vitest'
import { identityFields, company, effectiveColumns, octoberEmployees, octoberGrid } from './fixture'
import SendToDashboardButton from '../../src/components/SendToDashboardButton'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

test('no "Send to dashboard" button outside the dashboard', async () => {
  await import('../../src/payrollHubBridge.js')
  expect(window.PayrollHubBridge.isEmbedded()).toBe(false)
  expect(window.PayrollHubBridge.init({ appId: 'payroll' })).toBe(false)

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() =>
    root.render(
      <SendToDashboardButton
        identityFields={identityFields}
        effectiveColumns={effectiveColumns}
        employees={octoberEmployees}
        computedGrid={octoberGrid}
        companyName={company.name}
        companyDetails={company.details}
        year={2026}
        month={10}
      />
    )
  )
  expect(container.innerHTML).toBe('')
  act(() => root.unmount())
})
