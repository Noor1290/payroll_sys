// A small Excel formula evaluator, for the audit only. It works out what a
// spreadsheet program would show for the formulas the "Export with Live
// Formulas" file contains, so they can be compared with the app's figures
// without opening Excel.
//
// It reads Excel syntax (IF, AND, OR, NOT, MIN, MAX, ABS, SQRT, POWER, MOD,
// SUM, cell references, ranges) and is written independently of the app's
// own translator. It follows Excel's rules where they matter here:
//   - a text cell is never equal to a number ("Yes" = 1 is FALSE)
//   - an empty cell counts as 0 in arithmetic
//   - arithmetic on text is an error (#VALUE!)
//   - SUM, MIN and MAX over a range skip text cells

const ERROR = (code) => ({ error: code })
const isError = (v) => v !== null && typeof v === 'object' && 'error' in v

function tokenize(src) {
  const tokens = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
    } else if (/[0-9.]/.test(c)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      if (/[eE]/.test(src[j] ?? '') && /[-+0-9]/.test(src[j + 1] ?? '')) {
        j += 2
        while (j < src.length && /[0-9]/.test(src[j])) j++
      }
      tokens.push({ type: 'num', value: Number(src.slice(i, j)) })
      i = j
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_$.]/.test(src[j])) j++
      tokens.push({ type: 'name', value: src.slice(i, j).replace(/\$/g, '').toUpperCase() })
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < src.length && src[j] !== '"') j++
      tokens.push({ type: 'str', value: src.slice(i + 1, j) })
      i = j + 1
    } else if (src.startsWith('<=', i) || src.startsWith('>=', i) || src.startsWith('<>', i)) {
      tokens.push({ type: 'op', value: src.slice(i, i + 2) })
      i += 2
    } else if ('+-*/^=<>(),:'.includes(c)) {
      tokens.push({ type: 'op', value: c })
      i++
    } else {
      throw new Error(`Excel evaluator: unexpected character "${c}" in ${src}`)
    }
  }
  tokens.push({ type: 'end' })
  return tokens
}

const CELL = /^[A-Z]{1,3}[0-9]+$/

function parse(src) {
  const tokens = tokenize(src)
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (...values) => peek().type === 'op' && values.includes(peek().value)
  const take = () => tokens[pos++]
  function expectOp(value) {
    if (!isOp(value)) throw new Error(`Excel evaluator: expected "${value}" in ${src}`)
    take()
  }

  function comparison() {
    let left = additive()
    while (isOp('=', '<>', '<', '<=', '>', '>=')) {
      const op = take().value
      left = { type: 'binary', op, left, right: additive() }
    }
    return left
  }
  function additive() {
    let left = multiplicative()
    while (isOp('+', '-')) {
      const op = take().value
      left = { type: 'binary', op, left, right: multiplicative() }
    }
    return left
  }
  function multiplicative() {
    let left = power()
    while (isOp('*', '/')) {
      const op = take().value
      left = { type: 'binary', op, left, right: power() }
    }
    return left
  }
  function power() {
    let left = unary()
    while (isOp('^')) {
      take()
      left = { type: 'binary', op: '^', left, right: unary() }
    }
    return left
  }
  function unary() {
    if (isOp('-')) {
      take()
      return { type: 'negate', arg: unary() }
    }
    if (isOp('+')) {
      take()
      return unary()
    }
    return primary()
  }
  function primary() {
    const t = take()
    if (t.type === 'num') return { type: 'num', value: t.value }
    if (t.type === 'str') return { type: 'str', value: t.value }
    if (t.type === 'op' && t.value === '(') {
      const inner = comparison()
      expectOp(')')
      return inner
    }
    if (t.type === 'name') {
      if (isOp('(')) {
        take()
        const args = []
        if (!isOp(')')) {
          args.push(comparison())
          while (isOp(',')) {
            take()
            args.push(comparison())
          }
        }
        expectOp(')')
        return { type: 'call', name: t.value, args }
      }
      if (t.value === 'TRUE') return { type: 'bool', value: true }
      if (t.value === 'FALSE') return { type: 'bool', value: false }
      if (CELL.test(t.value)) {
        if (isOp(':')) {
          take()
          const end = take()
          return { type: 'range', from: t.value, to: end.value }
        }
        return { type: 'cell', ref: t.value }
      }
    }
    throw new Error(`Excel evaluator: cannot read ${src}`)
  }

  const tree = comparison()
  if (peek().type !== 'end') throw new Error(`Excel evaluator: trailing input in ${src}`)
  return tree
}

function columnNumber(letters) {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function columnLetters(n) {
  let s = ''
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function expandRange(from, to) {
  const [, c1, r1] = from.match(/^([A-Z]+)([0-9]+)$/)
  const [, c2, r2] = to.match(/^([A-Z]+)([0-9]+)$/)
  const refs = []
  for (let c = columnNumber(c1); c <= columnNumber(c2); c++) {
    for (let r = Number(r1); r <= Number(r2); r++) refs.push(`${columnLetters(c)}${r}`)
  }
  return refs
}

// Excel's ordering across types: numbers, then text, then logical values.
function typeRank(v) {
  if (typeof v === 'number') return 0
  if (typeof v === 'string') return 1
  return 2
}

function compare(a, b) {
  const x = a === null ? (typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0) : a
  const y = b === null ? (typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0) : b
  if (typeRank(x) !== typeRank(y)) return typeRank(x) - typeRank(y)
  if (typeof x === 'string') return x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0
  return x < y ? -1 : x > y ? 1 : 0
}

function toNumber(v) {
  if (isError(v)) return v
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = v.trim() === '' ? NaN : Number(v)
  return Number.isNaN(n) ? ERROR('#VALUE!') : n
}

function toBoolean(v) {
  if (isError(v)) return v
  if (typeof v === 'boolean') return v
  if (v === null) return false
  if (typeof v === 'number') return v !== 0
  return ERROR('#VALUE!')
}

// getCell(ref) returns a number, a string, a boolean, null for an empty
// cell, or { formula } for a formula cell (which is then worked out too).
export function evaluateExcelFormula(formula, getCell) {
  const seen = new Set()

  function valueOfCell(ref) {
    const raw = getCell(ref)
    if (raw !== null && typeof raw === 'object' && 'formula' in raw) {
      if (seen.has(ref)) return ERROR('#CIRC!')
      seen.add(ref)
      const v = run(parse(raw.formula))
      seen.delete(ref)
      return v
    }
    return raw ?? null
  }

  function numbersIn(args) {
    const out = []
    for (const arg of args) {
      if (arg.type === 'range') {
        for (const ref of expandRange(arg.from, arg.to)) {
          const v = valueOfCell(ref)
          if (isError(v)) return v
          if (typeof v === 'number') out.push(v)
        }
      } else if (arg.type === 'cell') {
        const v = valueOfCell(arg.ref)
        if (isError(v)) return v
        if (typeof v === 'number') out.push(v)
      } else {
        const v = toNumber(run(arg))
        if (isError(v)) return v
        out.push(v)
      }
    }
    return out
  }

  function run(node) {
    switch (node.type) {
      case 'num':
      case 'str':
      case 'bool':
        return node.value
      case 'cell':
        return valueOfCell(node.ref)
      case 'range':
        return ERROR('#VALUE!')
      case 'negate': {
        const v = toNumber(run(node.arg))
        return isError(v) ? v : -v
      }
      case 'binary': {
        const left = run(node.left)
        const right = run(node.right)
        if (isError(left)) return left
        if (isError(right)) return right
        if (['=', '<>', '<', '<=', '>', '>='].includes(node.op)) {
          const c = compare(left, right)
          return { '=': c === 0, '<>': c !== 0, '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0 }[node.op]
        }
        const a = toNumber(left)
        const b = toNumber(right)
        if (isError(a)) return a
        if (isError(b)) return b
        if (node.op === '+') return a + b
        if (node.op === '-') return a - b
        if (node.op === '*') return a * b
        if (node.op === '^') return a ** b
        return b === 0 ? ERROR('#DIV/0!') : a / b
      }
      case 'call': {
        const { name, args } = node
        if (name === 'IF') {
          const test = toBoolean(run(args[0]))
          if (isError(test)) return test
          return test ? run(args[1]) : args.length > 2 ? run(args[2]) : false
        }
        if (name === 'AND' || name === 'OR') {
          const values = args.map((a) => toBoolean(run(a)))
          const bad = values.find(isError)
          if (bad) return bad
          return name === 'AND' ? values.every(Boolean) : values.some(Boolean)
        }
        if (name === 'NOT') {
          const v = toBoolean(run(args[0]))
          return isError(v) ? v : !v
        }
        if (name === 'SUM' || name === 'MIN' || name === 'MAX') {
          const numbers = numbersIn(args)
          if (isError(numbers)) return numbers
          if (name === 'SUM') return numbers.reduce((s, n) => s + n, 0)
          if (numbers.length === 0) return 0
          return name === 'MIN' ? Math.min(...numbers) : Math.max(...numbers)
        }
        const numeric = args.map((a) => toNumber(run(a)))
        const bad = numeric.find(isError)
        if (bad) return bad
        if (name === 'ABS') return Math.abs(numeric[0])
        if (name === 'SQRT') return numeric[0] < 0 ? ERROR('#NUM!') : Math.sqrt(numeric[0])
        if (name === 'POWER') return numeric[0] ** numeric[1]
        if (name === 'MOD') return numeric[1] === 0 ? ERROR('#DIV/0!') : numeric[0] - numeric[1] * Math.floor(numeric[0] / numeric[1])
        throw new Error(`Excel evaluator: function ${name} is not supported`)
      }
      default:
        throw new Error(`Excel evaluator: unknown node ${node.type}`)
    }
  }

  return run(parse(formula))
}

export { isError as isExcelError }
