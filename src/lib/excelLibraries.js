// The two Excel libraries, loaded only when a file is read or made: together they are about
// half of the app, and opening the app does not need them. The browser keeps them after the
// first time.

export async function loadExcelJS() {
  const module = await import('exceljs')
  return module.default ?? module
}

export async function loadXLSX() {
  return import('xlsx')
}
