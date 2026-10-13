// @vitest-environment jsdom

// Full backup file: everything the app keeps in this browser, out to one
// file and back, exactly. TEST data only.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  BACKUP_APP_ID,
  buildBackup,
  buildBackupFilename,
  formatSavedAt,
  parseBackupText,
  restoreBackup,
  summarizeBackup,
} from '../../src/lib/backup'
import { buildColumnSetupExport } from '../../src/lib/columnSetup'
import { identityFields, idFieldKey, testColumns, testEmployees } from './build'

const STATE_KEY = 'payroll_app_state_v1'
const company = (letter, extra = {}) => ({
  id: `test-co-${letter.toLowerCase()}`,
  name: `TEST Co ${letter}`,
  columns: [],
  columnWidths: {},
  viewYear: 2026,
  viewMonth: 9,
  details: { address: `${letter} Test Street`, brn: `TEST-BRN-${letter}`, customFields: [] },
  ...extra,
})

// Two companies; A has three months, B has one. Plus a month left behind by
// a company that is no longer in the list, as older versions could leave.
function seed() {
  const state = {
    identityFields,
    idFieldKey,
    globalColumns: testColumns(),
    companies: [company('A', { columnWidths: { basicSalary: 140 } }), company('B')],
    activeCompanyId: 'test-co-a',
  }
  const [first, second, third] = testEmployees()
  localStorage.setItem(STATE_KEY, JSON.stringify(state))
  localStorage.setItem('payroll_period_test-co-a_2026-07', JSON.stringify({ employees: [first] }))
  localStorage.setItem('payroll_period_test-co-a_2026-08', JSON.stringify({ employees: [first, second] }))
  localStorage.setItem('payroll_period_test-co-a_2026-09', JSON.stringify({ employees: [first, second, third] }))
  localStorage.setItem('payroll_period_test-co-b_2026-09', JSON.stringify({ employees: [third] }))
  localStorage.setItem('payroll_period_test-co-gone_2025-12', JSON.stringify({ employees: [second] }))
  return state
}

// Everything in the browser's storage, key by key, exactly as stored.
const everything = () => Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)]))

// What a user does: back up, save the file, choose it again later.
const throughAFile = (backup) => {
  const parsed = parseBackupText(JSON.stringify(backup, null, 2))
  expect(parsed.valid).toBe(true)
  return parsed.backup
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('backing up', () => {
  test('the file holds the setup, every company and every month of every company', () => {
    const state = seed()
    const backup = buildBackup(new Date('2026-10-13T08:05:00.000Z'))

    expect(backup._meta).toEqual({ app: BACKUP_APP_ID, version: 1, exportedAt: '2026-10-13T08:05:00.000Z' })
    expect(backup.state).toEqual(state)
    expect(Object.keys(backup.periods)).toEqual([
      'payroll_period_test-co-a_2026-07',
      'payroll_period_test-co-a_2026-08',
      'payroll_period_test-co-a_2026-09',
      'payroll_period_test-co-b_2026-09',
      'payroll_period_test-co-gone_2025-12',
    ])
    expect(backup.periods['payroll_period_test-co-a_2026-09'].employees).toEqual(testEmployees())
    expect(backup.unreadable).toEqual({})
    expect(buildBackupFilename(new Date('2026-10-13T08:05:00.000Z'))).toBe('payroll-backup-2026-10-13.json')
  })

  test('it leaves out the theme and anything another app keeps at the same address', () => {
    seed()
    localStorage.setItem('payroll_theme', 'light')
    localStorage.setItem('pdf-editor:templates', '[{"name":"TEST form"}]')

    const text = JSON.stringify(buildBackup())

    expect(text).not.toContain('payroll_theme')
    expect(text).not.toContain('pdf-editor')
    expect(text).not.toContain('TEST form')
  })

  test('figures are in the file exactly as they are stored: nothing rounded, nothing filled in', () => {
    seed()
    const odd = { id: 'e-odd', values: { id: 'TST900', basicSalary: 18115.005, otherAllowance: '', bonus: '0.10', isPensioner: true } }
    localStorage.setItem('payroll_period_test-co-b_2026-10', JSON.stringify({ employees: [odd] }))

    const backup = throughAFile(buildBackup())

    expect(backup.periods['payroll_period_test-co-b_2026-10'].employees).toEqual([odd])
    expect(Object.keys(backup.periods['payroll_period_test-co-b_2026-10'].employees[0].values)).toEqual(Object.keys(odd.values))
  })
})

describe('restoring', () => {
  test('backup, empty browser, restore: the storage is the same, key for key and character for character', () => {
    seed()
    const before = everything()
    const backup = throughAFile(buildBackup())

    localStorage.clear()
    expect(restoreBackup(backup)).toEqual({ ok: true })

    expect(everything()).toEqual(before)
  })

  test('it replaces what is there: nothing of the data it replaced is left behind', () => {
    seed()
    const before = everything()
    const backup = throughAFile(buildBackup())

    // Meanwhile the browser's data moved on: another company, another month, a changed figure.
    localStorage.clear()
    localStorage.setItem(STATE_KEY, JSON.stringify({ identityFields, idFieldKey, globalColumns: [], companies: [company('Z')], activeCompanyId: 'test-co-z' }))
    localStorage.setItem('payroll_period_test-co-z_2027-01', JSON.stringify({ employees: testEmployees() }))
    localStorage.setItem('payroll_period_test-co-a_2026-09', JSON.stringify({ employees: [] }))

    expect(restoreBackup(backup)).toEqual({ ok: true })

    expect(everything()).toEqual(before)
    expect(localStorage.getItem('payroll_period_test-co-z_2027-01')).toBeNull()
  })

  test('it touches nothing but the payroll data: the theme and other apps stay as they are', () => {
    seed()
    const backup = throughAFile(buildBackup())
    localStorage.clear()
    localStorage.setItem('payroll_theme', 'light')
    localStorage.setItem('pdf-editor:templates', '[{"name":"TEST form"}]')

    restoreBackup(backup)

    expect(localStorage.getItem('payroll_theme')).toBe('light')
    expect(localStorage.getItem('pdf-editor:templates')).toBe('[{"name":"TEST form"}]')
  })

  test('saved data that cannot be read is carried along as it is, not dropped and not repaired', () => {
    seed()
    localStorage.setItem('payroll_period_test-co-b_2026-08', '{"employees":[{"id":"e1","values":{"basicSalary":18115')
    // Readable, but not written the way the app writes it: also kept character for character.
    localStorage.setItem('payroll_period_test-co-b_2026-07', '{ "employees": [] }')
    const before = everything()

    const built = buildBackup()
    expect(Object.keys(built.unreadable)).toEqual(['payroll_period_test-co-b_2026-07', 'payroll_period_test-co-b_2026-08'])
    expect(summarizeBackup(built).unreadableCount).toBe(2)

    const backup = throughAFile(built)
    localStorage.clear()
    restoreBackup(backup)

    expect(everything()).toEqual(before)
  })

  test('when the browser refuses a write, nothing is changed: what was there before is still there', () => {
    seed()
    const backup = throughAFile(buildBackup())
    localStorage.clear()
    localStorage.setItem(STATE_KEY, JSON.stringify({ identityFields, idFieldKey, globalColumns: [], companies: [company('Z')], activeCompanyId: 'test-co-z' }))
    localStorage.setItem('payroll_period_test-co-z_2027-01', JSON.stringify({ employees: testEmployees() }))
    const before = everything()

    // The browser's storage fills up at the third write of the restore.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const realSetItem = Storage.prototype.setItem
    let writes = 0
    let full = true
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (full && ++writes === 3) {
        full = false
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      return realSetItem.call(this, key, value)
    })

    expect(restoreBackup(backup)).toEqual({ ok: false, unchanged: true })
    expect(everything()).toEqual(before)
  })

  test('when even the earlier data cannot be put back, it says so instead of claiming nothing changed', () => {
    seed()
    const backup = throughAFile(buildBackup())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const realSetItem = Storage.prototype.setItem
    let writes = 0
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (++writes >= 3) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return realSetItem.call(this, key, value)
    })

    expect(restoreBackup(backup)).toEqual({ ok: false, unchanged: false })
  })
})

describe('a file that is not a usable backup', () => {
  const refused = (text) => {
    seed()
    const before = everything()
    const result = parseBackupText(text)
    expect(result.valid).toBe(false)
    expect(result.backup).toBeUndefined()
    expect(everything()).toEqual(before)
    return result.error
  }
  const backupWith = (change) => {
    seed()
    const backup = JSON.parse(JSON.stringify(buildBackup()))
    change(backup)
    localStorage.clear()
    return JSON.stringify(backup)
  }

  test('text that is not JSON, and JSON that is something else, are refused in plain words', () => {
    expect(refused('PK\u0003\u0004 not a backup')).toBe('This file is not a Payroll backup. Choose a file saved with "Back up".')
    expect(refused('[]')).toMatch(/not a Payroll backup/)
    expect(refused('{"employees":[]}')).toMatch(/not a Payroll backup/)
  })

  test('a Column Setup file is not mistaken for a backup', () => {
    const columnSetup = JSON.stringify(buildColumnSetupExport(testColumns(), 'global', null, null))
    expect(refused(columnSetup)).toMatch(/not a Payroll backup/)
  })

  test('a backup of another version is refused, not half-read', () => {
    expect(refused(backupWith((b) => (b._meta.version = 2)))).toMatch(/different version of Payroll/)
  })

  test('a damaged backup is refused whole, with the reason', () => {
    expect(refused(backupWith((b) => delete b.state.companies))).toMatch(/it has no list of companies/)
    expect(refused(backupWith((b) => delete b.state.companies[1].id))).toMatch(/one of its companies has no name or no id/)
    expect(refused(backupWith((b) => (b.periods['payroll_period_test-co-a_2026-09'] = { rows: [] })))).toMatch(/has no list of employees/)
    expect(refused(backupWith((b) => (b.periods['payroll_period_test-co-a_2026-13'] = { employees: [] })))).toMatch(/not named as a month/)
    expect(refused(backupWith((b) => (b.periods['pdf-editor:templates'] = { employees: [] })))).toMatch(/not named as a month/)
    expect(refused(backupWith((b) => (b.unreadable['pdf-editor:templates'] = '[]')))).toMatch(/not in the expected form/)
    expect(refused(backupWith((b) => (b.periods = [])))).toMatch(/months are not in the expected form/)
  })

  test('an empty backup is refused, so it cannot wipe the browser by mistake', () => {
    const empty = JSON.stringify(buildBackup())
    expect(refused(empty)).toMatch(/This backup is empty/)
  })
})

describe('what the restore dialog is told', () => {
  test('each company with its months and employee rows, and months of a company no longer listed', () => {
    seed()
    const summary = summarizeBackup(buildBackup(new Date('2026-10-13T08:05:00.000Z')))

    expect(summary).toEqual({
      exportedAt: '2026-10-13T08:05:00.000Z',
      companies: [
        { id: 'test-co-a', name: 'TEST Co A', months: 3, rows: 6, range: 'July 2026 to September 2026' },
        { id: 'test-co-b', name: 'TEST Co B', months: 1, rows: 1, range: 'September 2026' },
      ],
      monthCount: 5,
      globalColumnCount: testColumns().length,
      otherMonths: 1,
      unreadableCount: 0,
    })
  })

  test('the date a backup was saved is shown in this computer\'s own time, and left out when the file has none', () => {
    const zone = process.env.TZ
    process.env.TZ = 'UTC'
    try {
      expect(formatSavedAt('2026-10-13T08:05:00.000Z')).toBe('13 October 2026 at 08:05')
    } finally {
      if (zone === undefined) delete process.env.TZ
      else process.env.TZ = zone
    }
    expect(formatSavedAt(null)).toBeNull()
    expect(formatSavedAt('yesterday')).toBeNull()
  })
})
