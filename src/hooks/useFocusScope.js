import { useEffect, useRef } from 'react'

// Keyboard behaviour shared by the dialog shell, the drawer sidebar and the
// export menu. Presentation only: it never touches app data.
//
// While `active`:
//   - Escape calls `onEscape` (the layer's own existing close handler);
//   - with `trap`, focus moves into the container when it opens and Tab /
//     Shift+Tab cycle inside it, so nothing behind it is reachable by keyboard;
//   - when it closes, focus goes back to whatever had it before.
// Only the top-most open layer reacts, so a confirm dialog opened from
// another dialog handles Escape first. No other key is intercepted: typing
// in a field is never affected.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Open layers, bottom to top.
const stack = []

function focusableIn(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0)
}

export function useFocusScope(containerRef, { active = true, trap = true, onEscape } = {}) {
  // Always the latest handler, without re-running the effect on every render.
  const onEscapeRef = useRef(onEscape)
  useEffect(() => {
    onEscapeRef.current = onEscape
  })

  useEffect(() => {
    if (!active) return undefined
    const container = containerRef.current
    if (!container) return undefined

    const opener = document.activeElement
    const scope = { container }
    stack.push(scope)
    const isTop = () => stack[stack.length - 1] === scope

    // A field with autoFocus inside the container keeps the focus it already has.
    if (trap && !container.contains(document.activeElement)) container.focus()

    function onKeyDown(e) {
      if (!isTop()) return
      if (e.key === 'Escape') {
        // A control that has its own meaning for Escape (the rename box) keeps it.
        if (e.target instanceof Element && e.target.closest('[data-own-escape]')) return
        e.stopPropagation()
        onEscapeRef.current?.()
        return
      }
      if (e.key !== 'Tab' || !trap) return
      const items = focusableIn(container)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (!container.contains(current) || current === container) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (!e.shiftKey && current === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && current === first) {
        e.preventDefault()
        last.focus()
      }
    }

    // Focus that lands behind an open layer some other way is brought back.
    function onFocusIn(e) {
      if (!trap || !isTop()) return
      if (e.target instanceof Node && !container.contains(e.target)) container.focus()
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn)
      stack.splice(stack.indexOf(scope), 1)
      // Hand focus back, unless the user has already moved it somewhere else.
      const current = document.activeElement
      const lost = !current || current === document.body || container.contains(current) || !document.contains(current)
      if (lost && opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [active, trap, containerRef])
}
