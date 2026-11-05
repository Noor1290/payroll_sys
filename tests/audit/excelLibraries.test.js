// The two Excel libraries are loaded only when a file is read or made (speed fix F8,
// Payroll\SPEED_CHECK): no file of the app imports them when it opens. TEST data only.

import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { loadExcelJS, loadXLSX } from '../../src/lib/excelLibraries'

const filesUnder = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : /\.(js|jsx)$/.test(e.name) ? [path.join(dir, e.name)] : []))

test('no file of the app imports exceljs or xlsx up front', () => {
  const upFront = filesUnder(path.resolve(__dirname, '../../src')).filter((file) =>
    /^\s*import\s[^;]*?from\s+['"](exceljs|xlsx)['"]/m.test(fs.readFileSync(file, 'utf8'))
  )
  expect(upFront.map((f) => path.relative(path.resolve(__dirname, '../..'), f))).toEqual([])
})

test('they are there when a file is read or made', async () => {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('TEST').getCell('A1').value = 'TEST Co A'
  const XLSX = await loadXLSX()
  const read = XLSX.read(new Uint8Array(await wb.xlsx.writeBuffer()), { type: 'array' })
  expect(XLSX.utils.sheet_to_json(read.Sheets.TEST, { header: 1 })).toEqual([['TEST Co A']])
})
