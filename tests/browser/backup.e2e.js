// Browser test 5: the full backup file - "Back up" and "Restore" in the
// company list. The downloaded file is opened and read, then restored into
// another, empty browser profile. TEST data only.

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startApp, openSeeded, openEmpty, seededState, storedState, readEmployeeTable, dialog, download, periodStorageKey, testCompany, STATE_KEY } from './app'
import { testEmployees } from '../audit/build'

let app
beforeAll(async () => {
  app = await startApp()
})
afterAll(async () => {
  await app?.close()
})

const BACKUP_INPUT = 'input[type="file"][accept=".json,application/json"]'
const A = 'test-co-a'
const B = 'test-co-b'

// TEST Co A with August and September, TEST Co B with September.
function twoCompaniesThreeMonths() {
  const seed = seededState()
  const [first, second, third] = testEmployees()
  seed.periods[periodStorageKey(A, '2026-08')] = { employees: [first, second] }
  seed.periods[periodStorageKey(B, '2026-09')] = { employees: [third] }
  return seed
}

// Everything the payroll app keeps in the browser, exactly as stored.
const payrollStorage = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key === 'payroll_app_state_v1' || key.startsWith('payroll_period_'))
        .sort()
        .map((key) => [key, localStorage.getItem(key)])
    )
  )

const backUp = (page) => download(page, () => page.getByRole('button', { name: 'Back up', exact: true }).click())
const chooseBackup = (page, file) => page.locator(BACKUP_INPUT).setInputFiles({ name: file.name, mimeType: 'application/json', buffer: file.bytes })

describe('Back up', () => {
  test('downloads one file holding every company and every month, exactly as stored', async () => {
    const seed = twoCompaniesThreeMonths()
    const { context, page, outsideRequests } = await openSeeded(app, seed)
    try {
      const file = await backUp(page)

      expect(file.name).toMatch(/^payroll-backup-\d{4}-\d{2}-\d{2}\.json$/)
      const backup = JSON.parse(file.bytes.toString('utf8'))
      expect(backup._meta).toMatchObject({ app: 'payroll-sys-backup', version: 1 })
      expect(backup.state).toEqual(await storedState(page))
      expect(backup.state.companies.map((c) => c.name)).toEqual(['TEST Co A', 'TEST Co B'])
      expect(backup.periods).toEqual(seed.periods)
      expect(backup.unreadable).toEqual({})
      // Saving a backup changes nothing in the browser and sends nothing anywhere.
      expect(Object.keys(await payrollStorage(page))).toEqual([STATE_KEY, periodStorageKey(A, '2026-08'), periodStorageKey(A, '2026-09'), periodStorageKey(B, '2026-09')])
      expect(outsideRequests).toEqual([])
    } finally {
      await context.close()
    }
  })
})

describe('Restore', () => {
  test('into another, empty browser: the same data is stored and on screen', async () => {
    const first = await openSeeded(app, twoCompaniesThreeMonths())
    let file
    let original
    try {
      file = await backUp(first.page)
      original = await payrollStorage(first.page)
    } finally {
      await first.context.close()
    }

    const { context, page } = await openEmpty(app)
    try {
      await chooseBackup(page, file)

      // Nothing is replaced until the user has seen what is in the file and said so.
      const preview = dialog(page, 'Restore this backup?')
      await preview.waitFor()
      const text = await preview.innerText()
      expect(text).toContain(file.name)
      expect(text).toMatch(/TEST Co A\s+2 months \(August 2026 to September 2026\), 5 employee rows/)
      expect(text).toMatch(/TEST Co B\s+1 month \(September 2026\), 1 employee row/)
      expect(text).toContain('No companies and no months.')
      expect(Object.keys(await payrollStorage(page))).toEqual([STATE_KEY])

      await preview.getByRole('button', { name: 'Replace with this backup', exact: true }).click()
      const done = dialog(page, 'Backup restored')
      await done.waitFor()
      await done.getByRole('button', { name: 'OK', exact: true }).click()

      expect(await payrollStorage(page)).toEqual(original)
      // And the app shows it without a reload: the company that was selected, with its September employees.
      await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
      await page.getByRole('button', { name: 'TEST Co B', exact: true }).waitFor()
      const rows = await readEmployeeTable(page)
      expect(rows.map((row) => row.ID)).toEqual(testEmployees().map((e) => e.values.id))

      // It is still all there after a reload.
      await page.reload()
      await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
      expect(await payrollStorage(page)).toEqual(original)
    } finally {
      await context.close()
    }
  })

  test('replaces what is in the browser only after "Replace with this backup"; Cancel changes nothing', async () => {
    const source = await openSeeded(app, twoCompaniesThreeMonths())
    let file
    let original
    try {
      file = await backUp(source.page)
      original = await payrollStorage(source.page)
    } finally {
      await source.context.close()
    }

    // A browser that holds something else: one other company with one month.
    const other = testCompany('Z', { id: 'test-co-z', name: 'TEST Co Z' })
    const seed = seededState()
    seed.state = { ...seed.state, companies: [other], activeCompanyId: other.id }
    seed.periods = { [periodStorageKey(other.id, '2026-09')]: { employees: testEmployees().slice(0, 1) } }
    const { context, page } = await openSeeded(app, seed)
    try {
      const before = await payrollStorage(page)

      await chooseBackup(page, file)
      const preview = dialog(page, 'Restore this backup?')
      await preview.waitFor()
      expect(await preview.innerText()).toMatch(/In this browser now\s+TEST Co Z\s+1 month \(September 2026\), 1 employee row/)
      expect(await preview.getByRole('alert').innerText()).toContain('What is in this browser now will be removed. To keep it, back it up first.')

      // "Back up what is here" saves the browser's own data, not the file's.
      const mine = await download(page, () => preview.getByRole('button', { name: 'Back up what is here', exact: true }).click())
      expect(JSON.parse(mine.bytes.toString('utf8')).state.companies.map((c) => c.name)).toEqual(['TEST Co Z'])

      await preview.getByRole('button', { name: 'Cancel', exact: true }).click()
      await preview.waitFor({ state: 'hidden' })
      expect(await payrollStorage(page)).toEqual(before)

      await chooseBackup(page, file)
      await preview.getByRole('button', { name: 'Replace with this backup', exact: true }).click()
      await dialog(page, 'Backup restored').getByRole('button', { name: 'OK', exact: true }).click()

      expect(await payrollStorage(page)).toEqual(original)
      await page.getByRole('button', { name: 'TEST Co A', exact: true }).waitFor()
      expect(await page.getByRole('button', { name: 'TEST Co Z', exact: true }).count()).toBe(0)
    } finally {
      await context.close()
    }
  })

  test('a file that is not a backup is refused in plain words, and nothing is changed', async () => {
    const { context, page } = await openSeeded(app, twoCompaniesThreeMonths())
    try {
      const before = await payrollStorage(page)

      await page.locator(BACKUP_INPUT).setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('[{"ID":"TST001"}]') })

      const refused = dialog(page, 'This file cannot be restored')
      await refused.waitFor()
      expect(await refused.innerText()).toContain('This file is not a Payroll backup. Choose a file saved with "Back up".')
      await refused.getByRole('button', { name: 'OK', exact: true }).click()
      await refused.waitFor({ state: 'hidden' })
      expect(await dialog(page, 'Restore this backup?').count()).toBe(0)
      expect(await payrollStorage(page)).toEqual(before)
    } finally {
      await context.close()
    }
  })

  test('when the browser\'s storage is full the backup is NOT restored, and what was there stays', async () => {
    const source = await openSeeded(app, twoCompaniesThreeMonths())
    let file
    try {
      file = await backUp(source.page)
    } finally {
      await source.context.close()
    }

    const { context, page } = await openEmpty(app)
    try {
      const before = await payrollStorage(page)
      // The browser refuses the second write of the restore, as it does when its storage is full.
      await page.evaluate(() => {
        const real = Storage.prototype.setItem
        let writes = 0
        Storage.prototype.setItem = function (key, value) {
          if (String(key).startsWith('payroll_') && ++writes === 2) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
          return real.call(this, key, value)
        }
      })

      await chooseBackup(page, file)
      await dialog(page, 'Restore this backup?').getByRole('button', { name: 'Replace with this backup', exact: true }).click()

      const failed = dialog(page, 'The backup was NOT restored')
      await failed.waitFor()
      expect(await failed.innerText()).toContain('Nothing was changed: this browser holds what it held before.')
      await failed.getByRole('button', { name: 'OK', exact: true }).click()
      expect(await payrollStorage(page)).toEqual(before)
      await page.getByText('No companies yet.').waitFor()
    } finally {
      await context.close()
    }
  })
})

describe("Clear this browser's data", () => {
  // Another app at the same address, the rescue copy of unreadable data, and the offline copy.
  const OTHERS = {
    'other-app_settings': '{"keep":true}',
    'payroll_app_state_v1_unreadable_2026-10-16T09:00:00.000Z': '{"companies": [ damaged',
  }
  const OFFLINE_KEY = 'payroll_dashboard_offline_v1'
  const allStorage = (page) =>
    page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])))
  const notPayroll = (stored) => Object.fromEntries(Object.entries(stored).filter(([key]) => key !== STATE_KEY && !key.startsWith('payroll_period_')))

  async function openWithOthers() {
    const opened = await openSeeded(app, twoCompaniesThreeMonths())
    await opened.page.evaluate(
      ([others, offlineKey]) => {
        for (const [key, text] of Object.entries(others)) localStorage.setItem(key, text)
        localStorage.setItem(offlineKey, '{"TEST-BRN-A":{"brn":"TEST-BRN-A","label":"TEST Co A","loadedAt":"2026-10-15T18:22:00.000Z"}}')
      },
      [OTHERS, OFFLINE_KEY]
    )
    const errors = []
    opened.page.on('pageerror', (e) => errors.push(e.message))
    return { ...opened, errors }
  }

  // Opens the dialog (which downloads the backup), chooses, types CLEAR and clears.
  async function clearThrough(page, choice) {
    const file = await download(page, () => page.getByRole('button', { name: "Clear this browser's data…" }).click())
    const box = dialog(page, "Clear this browser's data")
    await box.waitFor()
    expect(await box.innerText()).toContain(`A backup of everything here was downloaded: ${file.name}.`)
    expect(await box.getByRole('button', { name: 'Clear', exact: true }).isDisabled()).toBe(true)
    await box.getByRole('radio', { name: new RegExp(`^${choice}`) }).check()
    const confirmBox = box.getByLabel('3. Type CLEAR to confirm')
    await confirmBox.fill('clear')
    const button = box.getByRole('button', { name: choice === 'Clear everything' ? 'Clear everything' : 'Clear columns', exact: true })
    expect(await button.isDisabled()).toBe(true)
    await confirmBox.fill('CLEAR')
    await button.click()
    return file
  }

  async function restoreFrom(page, file) {
    await chooseBackup(page, file)
    await dialog(page, 'Restore this backup?').getByRole('button', { name: 'Replace with this backup', exact: true }).click()
    const done = dialog(page, 'Backup restored')
    await done.waitFor()
    await done.getByRole('button', { name: 'OK', exact: true }).click()
  }

  test('"Clear everything": the normal empty start, other keys untouched, and Restore from the downloaded file brings it all back', async () => {
    const { context, page, errors, outsideRequests } = await openWithOthers()
    try {
      const original = await payrollStorage(page)
      const before = await allStorage(page)

      const file = await clearThrough(page, 'Clear everything')
      const done = dialog(page, "This browser's data cleared")
      await done.waitFor()
      await done.getByRole('button', { name: 'OK', exact: true }).click()
      await page.getByText('No companies yet.').waitFor()

      // Only the app's empty start is stored (as on a first visit); the offline copy is gone; the rest is untouched.
      const after = await allStorage(page)
      expect(Object.keys(await payrollStorage(page))).toEqual([STATE_KEY])
      expect(JSON.parse(after[STATE_KEY]).companies).toEqual([])
      const { [OFFLINE_KEY]: offline, ...othersBefore } = notPayroll(before)
      expect(offline).toBeTruthy()
      expect(notPayroll(after)).toEqual(othersBefore)
      expect(errors).toEqual([])

      // The downloaded file is the whole backup, and Restore brings it back identically.
      expect(JSON.parse(file.bytes.toString('utf8')).periods).toEqual(twoCompaniesThreeMonths().periods)
      await restoreFrom(page, file)
      expect(await payrollStorage(page)).toEqual(original)
      expect(notPayroll(await allStorage(page))).toEqual(othersBefore)
      await page.getByRole('button', { name: 'TEST Co B', exact: true }).waitFor()
      expect(errors).toEqual([])
      expect(outsideRequests).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('"Clear columns only": companies and months kept, columns gone, and Restore brings the columns back identically', async () => {
    const { context, page, errors } = await openWithOthers()
    try {
      const original = await payrollStorage(page)
      const before = await allStorage(page)

      const file = await clearThrough(page, 'Clear columns only')
      const done = dialog(page, 'Columns cleared')
      await done.waitFor()
      await done.getByRole('button', { name: 'OK', exact: true }).click()
      await page.getByRole('button', { name: 'TEST Co B', exact: true }).waitFor()

      const state = await storedState(page)
      expect(state.identityFields).toEqual([])
      expect(state.globalColumns).toEqual([])
      expect(state.companies.map((c) => [c.name, c.columns, c.details])).toEqual(
        JSON.parse(original[STATE_KEY]).companies.map((c) => [c.name, [], c.details])
      )
      const after = await allStorage(page)
      expect(Object.keys(after)).toEqual(Object.keys(before))
      for (const key of Object.keys(before).filter((k) => k !== STATE_KEY)) expect([key, after[key]]).toEqual([key, before[key]])
      expect(errors).toEqual([])

      await restoreFrom(page, file)
      expect(await payrollStorage(page)).toEqual(original)
      expect(notPayroll(await allStorage(page))).toEqual(notPayroll(before))
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })
})
