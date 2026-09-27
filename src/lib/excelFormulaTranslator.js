// Translates the app's internal JS-like formula expressions (the same
// strings the formula engine evaluates - see formulaEngine.js/tieredFormula.js)
// into real Excel formula syntax, so a Formula column can be exported as a
// live, recalculating cell instead of a static number.
//
// This is a genuine (if small) parser, not a regex substitution: ternaries,
// Math.min/max calls, and operator differences (===, &&, ||, %) all need
// structural translation that a find-and-replace can't do correctly once
// expressions nest.
//
// Tiered/Conditional rules need no special handling here at all - they're
// already compiled (see tieredFormula.js's compileTieredFormula) into the
// same nested-ternary JS expression format as any other formula, so the
// generic ternary -> IF() translation below produces the right nested
// IF() chain automatically.

function tokenize(expr) {
  const tokens = []
  let i = 0
  const n = expr.length
  while (i < n) {
    const c = expr[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    // A bare "." (as in Math.min) must NOT be swallowed as a number - only
    // treat "." as starting a number when a digit actually follows it.
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      let j = i
      while (j < n && /[0-9.]/.test(expr[j])) j++
      tokens.push({ type: 'NUMBER', value: expr.slice(i, j) })
      i = j
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(expr[j])) j++
      tokens.push({ type: 'IDENT', value: expr.slice(i, j) })
      i = j
      continue
    }
    if (c === '.') {
      tokens.push({ type: 'DOT' })
      i++
      continue
    }
    if (c === '(') {
      tokens.push({ type: 'LPAREN' })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ type: 'RPAREN' })
      i++
      continue
    }
    if (c === ',') {
      tokens.push({ type: 'COMMA' })
      i++
      continue
    }
    if (c === '?') {
      tokens.push({ type: 'QUESTION' })
      i++
      continue
    }
    if (c === ':') {
      tokens.push({ type: 'COLON' })
      i++
      continue
    }
    const three = expr.slice(i, i + 3)
    if (three === '===' || three === '!==') {
      tokens.push({ type: 'OP', value: three === '===' ? '==' : '!=' })
      i += 3
      continue
    }
    const two = expr.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'OP', value: two })
      i += 2
      continue
    }
    if ('+-*/%<>!'.includes(c)) {
      tokens.push({ type: 'OP', value: c })
      i++
      continue
    }
    throw new Error(`Unexpected character in formula: "${c}"`)
  }
  tokens.push({ type: 'EOF' })
  return tokens
}

// Recursive-descent parser mirroring JS operator precedence (ternary is
// lowest/outermost, unary highest), enough to cover what the column-form
// and tiered-rule builder ever produce.
function parseExpression(tokens) {
  let pos = 0
  const peek = () => tokens[pos]
  const next = () => tokens[pos++]
  function expect(type) {
    const t = next()
    if (t.type !== type) throw new Error(`Expected ${type} but got ${t.type}`)
    return t
  }

  function parseTernary() {
    const test = parseLogicalOr()
    if (peek().type === 'QUESTION') {
      next()
      const consequent = parseTernary()
      expect('COLON')
      const alternate = parseTernary()
      return { type: 'Ternary', test, consequent, alternate }
    }
    return test
  }

  function parseLogicalOr() {
    let left = parseLogicalAnd()
    while (peek().type === 'OP' && peek().value === '||') {
      next()
      left = { type: 'Logical', op: '||', left, right: parseLogicalAnd() }
    }
    return left
  }

  function parseLogicalAnd() {
    let left = parseEquality()
    while (peek().type === 'OP' && peek().value === '&&') {
      next()
      left = { type: 'Logical', op: '&&', left, right: parseEquality() }
    }
    return left
  }

  function parseEquality() {
    let left = parseRelational()
    while (peek().type === 'OP' && (peek().value === '==' || peek().value === '!=')) {
      const op = next().value
      left = { type: 'Binary', op, left, right: parseRelational() }
    }
    return left
  }

  function parseRelational() {
    let left = parseAdditive()
    while (peek().type === 'OP' && ['<', '<=', '>', '>='].includes(peek().value)) {
      const op = next().value
      left = { type: 'Binary', op, left, right: parseAdditive() }
    }
    return left
  }

  function parseAdditive() {
    let left = parseMultiplicative()
    while (peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value
      left = { type: 'Binary', op, left, right: parseMultiplicative() }
    }
    return left
  }

  function parseMultiplicative() {
    let left = parseUnary()
    while (peek().type === 'OP' && ['*', '/', '%'].includes(peek().value)) {
      const op = next().value
      left = { type: 'Binary', op, left, right: parseUnary() }
    }
    return left
  }

  function parseUnary() {
    if (peek().type === 'OP' && (peek().value === '-' || peek().value === '!')) {
      const op = next().value
      return { type: 'Unary', op, arg: parseUnary() }
    }
    return parsePrimary()
  }

  function parsePrimary() {
    const t = peek()
    if (t.type === 'NUMBER') {
      next()
      return { type: 'Number', value: t.value }
    }
    if (t.type === 'LPAREN') {
      next()
      const e = parseTernary()
      expect('RPAREN')
      return e
    }
    if (t.type === 'IDENT') {
      next()
      let name = t.value
      if (peek().type === 'DOT') {
        next()
        name = `${name}.${expect('IDENT').value}`
      }
      if (peek().type === 'LPAREN') {
        next()
        const args = []
        if (peek().type !== 'RPAREN') {
          args.push(parseTernary())
          while (peek().type === 'COMMA') {
            next()
            args.push(parseTernary())
          }
        }
        expect('RPAREN')
        return { type: 'Call', callee: name, args }
      }
      return { type: 'Identifier', name }
    }
    throw new Error(`Unexpected token in formula: ${t.type}`)
  }

  const result = parseTernary()
  if (peek().type !== 'EOF') throw new Error('Unexpected trailing input in formula')
  return result
}

const MATH_FUNCTIONS = {
  'Math.min': 'MIN',
  'Math.max': 'MAX',
  'Math.abs': 'ABS',
  'Math.sqrt': 'SQRT',
  'Math.pow': 'POWER',
}

function translateNode(node, resolveCellRef) {
  switch (node.type) {
    case 'Number':
      return node.value
    case 'Identifier': {
      const ref = resolveCellRef(node.name)
      if (!ref) throw new Error(`Unknown reference: ${node.name}`)
      return ref
    }
    case 'Unary': {
      const arg = translateNode(node.arg, resolveCellRef)
      if (node.op === '-') return `(-${arg})`
      if (node.op === '!') return `NOT(${arg})`
      throw new Error(`Unsupported unary operator: ${node.op}`)
    }
    case 'Binary': {
      const left = translateNode(node.left, resolveCellRef)
      const right = translateNode(node.right, resolveCellRef)
      switch (node.op) {
        case '+':
        case '-':
        case '*':
        case '/':
        case '<':
        case '<=':
        case '>':
        case '>=':
          return `(${left}${node.op}${right})`
        case '%':
          return `MOD(${left},${right})`
        case '==':
          return `(${left}=${right})`
        case '!=':
          return `(${left}<>${right})`
        default:
          throw new Error(`Unsupported operator: ${node.op}`)
      }
    }
    case 'Logical': {
      const left = translateNode(node.left, resolveCellRef)
      const right = translateNode(node.right, resolveCellRef)
      if (node.op === '&&') return `AND(${left},${right})`
      if (node.op === '||') return `OR(${left},${right})`
      throw new Error(`Unsupported logical operator: ${node.op}`)
    }
    case 'Ternary': {
      const test = translateNode(node.test, resolveCellRef)
      const consequent = translateNode(node.consequent, resolveCellRef)
      const alternate = translateNode(node.alternate, resolveCellRef)
      return `IF(${test},${consequent},${alternate})`
    }
    case 'Call': {
      const args = node.args.map((a) => translateNode(a, resolveCellRef))
      const excelFn = MATH_FUNCTIONS[node.callee]
      if (!excelFn) throw new Error(`Unsupported function: ${node.callee}`)
      return `${excelFn}(${args.join(',')})`
    }
    default:
      throw new Error(`Unsupported expression: ${node.type}`)
  }
}

// Translates one internal formula expression into an Excel formula string
// (no leading "="), given `resolveCellRef(columnKey) -> "E2" | null`.
// Throws on anything it can't faithfully translate - callers should catch
// this and fall back to the static computed value for that cell.
export function translateFormulaToExcel(expr, resolveCellRef) {
  const ast = parseExpression(tokenize(expr))
  return translateNode(ast, resolveCellRef)
}

// 1 -> "A", 2 -> "B", ..., 27 -> "AA" (standard spreadsheet column naming).
export function excelColumnLetter(n) {
  let s = ''
  let num = n
  while (num > 0) {
    const rem = (num - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    num = Math.floor((num - 1) / 26)
  }
  return s
}
