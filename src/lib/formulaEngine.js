// Formula engine: parses JS-like expressions that reference column keys as
// variables, evaluates them safely, tracks dependencies, detects circular
// references, and builds a full substitution trace for the breakdown view.

import { buildTieredExplanation, buildCompareExplanation } from './tieredFormula'
import { buildProgressiveExplanation } from './progressiveFormula'
import { evaluateExemptionCondition, buildExemptionExplanation } from './exemptionCondition'
import { formatDecimal } from './format'
import { outdatedTieredRule } from './outdatedRules'

// Identifiers that are safe to leave unresolved in an expression (global
// JS values/functions) rather than flagging as an "unknown column reference".
// The Math functions are only reached as Math.min, Math.round and so on: a
// bare "min" or "round" does not exist, so it is an unknown name.
const ALLOWED_GLOBALS = new Set([
  'Math', 'Number', 'String', 'Boolean',
  'parseFloat', 'parseInt', 'Infinity', 'NaN', 'undefined',
  'true', 'false',
])

// The first line of a refusal for a formula that could only ever show Error,
// and the hints for its two common causes. The line after it is the message
// a cell would show.
const CANNOT_SAVE = "This formula can't be saved:"
const MATH_HINT_NAMES = new Set(['min', 'max', 'round'])
const MATH_HINT = 'Did you mean Math.min, Math.max or Math.round?'
const YES_NO_HINT = 'The formula must give a number. For a yes/no rule, use a condition such as (x > 5 ? 1 : 0).'

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Extracts every identifier-like token from an expression (crude but
// sufficient for a JS-like arithmetic expression language). A name after a
// dot is a property, not a name of its own: "Math.max" gives "Math" only.
function extractIdentifiersSafe(expr) {
  const matches = String(expr).match(/(?<![.\w$])[A-Za-z_$][A-Za-z0-9_$]*/g)
  return matches ? Array.from(new Set(matches)) : []
}

// Returns the subset of availableKeys that are referenced (as whole-word
// matches) inside the expression.
export function getDependencies(expr, availableKeys) {
  if (!expr) return []
  return availableKeys.filter((key) => {
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`)
    return re.test(expr)
  })
}

// Display-only: renders a formula with each referenced column's KEY swapped
// for its readable LABEL (e.g. "newBasicSalary" -> "New Basic Salary", or
// "CSG (Employee Contribution)" when disambiguated), for read-only list
// views like ColumnManager. Never used for anything that actually computes
// or edits the formula - the stored expression, the builder, the engine,
// and the Excel export all keep using the real keys untouched.
//
// A single alternation-based pass (not one replace() call per key) so a
// label that happens to contain another column's key as a substring can
// never get double-substituted.
export function formatFormulaForDisplay(expr, labelByKey) {
  if (!expr) return expr
  const keys = Object.keys(labelByKey)
  if (keys.length === 0) return expr
  const pattern = new RegExp(`\\b(${keys.map(escapeRegExp).join('|')})\\b`, 'g')
  return expr.replace(pattern, (match) => labelByKey[match] ?? match)
}

// Validates that a formula only references known columns / allowed globals,
// and is syntactically valid JS. Returns { valid, error, dependencies }.
export function validateFormulaSyntax(expr, availableKeys) {
  if (!expr || !expr.trim()) {
    return { valid: false, error: 'Formula cannot be empty', dependencies: [] }
  }

  const identifiers = extractIdentifiersSafe(expr)
  const availableSet = new Set(availableKeys)
  const unknown = identifiers.filter(
    (id) => !availableSet.has(id) && !ALLOWED_GLOBALS.has(id)
  )

  if (unknown.length > 0) {
    const message = `Unknown column reference: ${unknown.join(', ')}`
    // A bare Math function ("min" for Math.min) was allowed before October
    // 2026 and then always showed Error; it is said plainly, with a hint.
    if (unknown.some((name) => typeof Math[name] === 'function')) {
      const hint = unknown.some((name) => MATH_HINT_NAMES.has(name)) ? `\n${MATH_HINT}` : ''
      return { valid: false, error: `${CANNOT_SAVE}\n${message}${hint}`, dependencies: [] }
    }
    return { valid: false, error: message, dependencies: [] }
  }

  try {
    // eslint-disable-next-line no-new-func
    new Function(...availableKeys, `"use strict"; return (${expr});`)
  } catch (e) {
    return { valid: false, error: `Syntax error: ${e.message}`, dependencies: [] }
  }

  // Worked out once with every column at 1, the way a cell is: a formula
  // that cannot give a number for any employee (a comparison on its own, a
  // function that does not exist) is refused here, with the message the
  // cell would show, instead of being saved to show Error everywhere.
  // Dividing by zero or the like is left to the cells: it depends on the figures.
  const dependencies = getDependencies(expr, availableKeys)
  try {
    const sample = evaluateFormula(expr, Object.fromEntries(dependencies.map((key) => [key, 1])))
    if (typeof sample !== 'number') {
      const hint = typeof sample === 'boolean' ? `\n${YES_NO_HINT}` : ''
      return { valid: false, error: `${CANNOT_SAVE}\nFormula did not return a number (got ${typeof sample})${hint}`, dependencies: [] }
    }
  } catch (e) {
    return { valid: false, error: `${CANNOT_SAVE}\n${e.message}`, dependencies: [] }
  }

  return { valid: true, error: null, dependencies }
}

// Builds a dependency graph (key -> [dependency keys]) for every formula
// column in `columnsByKey`, then checks whether adding/editing `targetKey`
// with `targetExpr` would introduce a cycle. Returns { hasCycle, cyclePath }.
export function detectCircularReference(targetKey, targetExpr, columnsByKey) {
  const graph = {}
  for (const [key, col] of Object.entries(columnsByKey)) {
    if (col.type === 'formula') {
      graph[key] = getDependencies(col.formula, Object.keys(columnsByKey))
    }
  }
  graph[targetKey] = getDependencies(targetExpr, Object.keys(columnsByKey))

  const visiting = new Set()
  const visited = new Set()
  let cyclePath = null

  function dfs(node, path) {
    if (cyclePath) return true
    if (visiting.has(node)) {
      cyclePath = [...path, node]
      return true
    }
    if (visited.has(node)) return false

    visiting.add(node)
    for (const dep of graph[node] || []) {
      if (dfs(dep, [...path, node])) return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }

  const hasCycle = dfs(targetKey, [])
  return { hasCycle, cyclePath }
}

// Evaluates a formula given a map of dependency key -> numeric value.
export function evaluateFormula(expr, values) {
  const keys = Object.keys(values)
  const args = keys.map((k) => values[k])
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, `"use strict"; return (${expr});`)
  return fn(...args)
}

// Replaces each dependency key in the expression with its resolved numeric
// value, for display in the breakdown view, e.g.
// "basicSalary * 0.03 + bonus" -> "5000 * 0.03 + 200" - each substituted
// value rounded to display using ITS OWN column's configured decimal
// places, not a single fixed precision for the whole expression.
export function buildSubstitutedExpression(expr, deps, valuesMap, columnsByKey) {
  let result = expr
  for (const key of deps) {
    const decimals = columnsByKey?.[key]?.decimals ?? 2
    const re = new RegExp(`\\b${escapeRegExp(key)}\\b`, 'g')
    const value = typeof valuesMap[key] === 'number' && !Number.isNaN(valuesMap[key]) ? valuesMap[key] : NaN
    result = result.replace(re, Number.isNaN(value) ? 'NaN' : formatDecimal(value, decimals, { grouping: false }))
  }
  return result
}

// Computes a single column's value for an employee, recursively resolving
// formula dependencies and building a full trace object for the breakdown
// view. `memo` and `visiting` should be fresh per-employee to avoid stale
// cross-employee caching and to detect runtime cycles defensively.
export function computeCell(key, employee, columnsByKey, memo, visiting = new Set()) {
  if (memo.has(key)) return memo.get(key)

  const col = columnsByKey[key]
  if (!col) {
    const result = { value: undefined, trace: { key, name: key, type: 'unknown', error: 'Unknown column' } }
    memo.set(key, result)
    return result
  }

  if (visiting.has(key)) {
    const result = {
      value: NaN,
      trace: { key, name: col.name, type: col.type, error: 'Circular reference detected' },
    }
    memo.set(key, result)
    return result
  }

  if (col.type === 'input') {
    const raw = employee.values ? employee.values[key] : undefined

    if (col.valueType === 'text') {
      const value = raw === undefined || raw === null ? '' : String(raw)
      const result = { value, trace: { key, name: col.name, type: 'input', valueType: 'text', value } }
      memo.set(key, result)
      return result
    }

    if (col.valueType === 'checkbox') {
      const checked = raw === true || raw === 1 || raw === '1' || raw === 'true'
      const value = checked ? 1 : 0
      const result = { value, trace: { key, name: col.name, type: 'input', valueType: 'checkbox', checked, value } }
      memo.set(key, result)
      return result
    }

    const value = raw === '' || raw === undefined || raw === null || Number.isNaN(Number(raw)) ? 0 : Number(raw)
    const result = { value, trace: { key, name: col.name, type: 'input', decimals: col.decimals ?? 2, value } }
    memo.set(key, result)
    return result
  }

  // formula column
  visiting.add(key)
  const availableKeys = Object.keys(columnsByKey)
  const deps = getDependencies(col.formula, availableKeys.filter((k) => k !== key))

  const depValues = {}
  const depTraces = []
  for (const dep of deps) {
    const r = computeCell(dep, employee, columnsByKey, memo, visiting)
    depValues[dep] = typeof r.value === 'number' ? r.value : 0
    depTraces.push(r.trace)
  }
  visiting.delete(key)

  // A figure worked out from a figure in error is itself in error: it is
  // never calculated from a made-up value, and it says which column to look at.
  const brokenDependency = depTraces.find((t) => t.error)
  if (brokenDependency) {
    const result = {
      value: NaN,
      trace: {
        key,
        name: col.name,
        type: 'formula',
        formula: col.formula,
        value: NaN,
        decimals: col.decimals ?? 2,
        error: `"${brokenDependency.name}" is in error`,
        dependencies: depTraces,
      },
    }
    memo.set(key, result)
    return result
  }

  let value
  let error
  try {
    value = evaluateFormula(col.formula, depValues)
    if (typeof value !== 'number') {
      error = `Formula did not return a number (got ${typeof value})`
      value = NaN
    } else if (!Number.isFinite(value)) {
      // Infinity comes from dividing by zero; "not a number" from 0 / 0 and
      // the like. Neither is a figure.
      error = Number.isNaN(value) ? 'The calculation has no result (for example 0 divided by 0)' : 'Division by zero'
      value = NaN
    }
  } catch (e) {
    error = e.message
    value = NaN
  }

  const substituted = buildSubstitutedExpression(col.formula, deps, depValues, columnsByKey)
  const decimals = col.decimals ?? 2

  let tiered
  let compare
  let progressive
  let exemption
  let exemptionMatched = false

  if (!error && col.exemption?.enabled) {
    exemptionMatched = evaluateExemptionCondition(col.exemption, depValues)
    exemption = buildExemptionExplanation({
      exemption: col.exemption,
      columnsByKey,
      depValues,
      matched: exemptionMatched,
      resultValue: value,
      resultDecimals: decimals,
      columnLabel: col.name,
    })
  }

  // The underlying Tiered/Progressive/Compare explanation is only
  // meaningful (and only correct) when the outer `value` actually came
  // from that calculation - i.e. the exemption didn't short-circuit it to
  // an override result instead.
  if (!error && !exemptionMatched) {
    if (col.builderMode === 'tiered') {
      if (col.tieredKind === 'compare' && col.compare) {
        const { columnAKey, columnBKey } = col.compare
        const valueA = depValues[columnAKey] ?? 0
        const valueB = depValues[columnBKey] ?? 0
        const columnAName = columnsByKey[columnAKey]?.name ?? columnAKey
        const columnBName = columnsByKey[columnBKey]?.name ?? columnBKey
        const aDecimals = columnsByKey[columnAKey]?.decimals ?? 2
        const bDecimals = columnsByKey[columnBKey]?.decimals ?? 2
        compare = buildCompareExplanation(col.compare, columnAName, columnBName, valueA, valueB, value, aDecimals, bDecimals, decimals)
      } else if (col.tiered) {
        const baseValue = depValues[col.tiered.baseKey] ?? 0
        const baseName = columnsByKey[col.tiered.baseKey]?.name ?? col.tiered.baseKey
        const baseDecimals = columnsByKey[col.tiered.baseKey]?.decimals ?? 2
        tiered = buildTieredExplanation(col.tiered, baseValue, baseName, value, baseDecimals, decimals, outdatedTieredRule(col) !== null)
      }
    } else if (col.builderMode === 'progressive' && col.progressive) {
      const baseValue = depValues[col.progressive.baseKey] ?? 0
      const baseName = columnsByKey[col.progressive.baseKey]?.name ?? col.progressive.baseKey
      const baseDecimals = columnsByKey[col.progressive.baseKey]?.decimals ?? 2
      progressive = buildProgressiveExplanation(col.progressive, baseValue, baseName, value, baseDecimals, decimals)
    }
  }

  const result = {
    value,
    trace: {
      key,
      name: col.name,
      type: 'formula',
      formula: col.formula,
      substituted,
      value,
      decimals,
      error,
      dependencies: depTraces,
      tiered,
      compare,
      progressive,
      exemption,
    },
  }
  memo.set(key, result)
  return result
}

// Precomputes { [employeeId]: { [columnKey]: { value, trace } } } for a
// list of employees against a shared column set. Used both by the live
// Employee Table (one period's employees) and by the Totals aggregator
// (each period's employees computed independently before summing).
export function computeGridForEmployees(employees, effectiveColumns, columnsByKey) {
  const grid = {}
  for (const employee of employees) {
    const memo = new Map()
    const row = {}
    for (const col of effectiveColumns) {
      row[col.key] = computeCell(col.key, employee, columnsByKey, memo)
    }
    grid[employee.id] = row
  }
  return grid
}
