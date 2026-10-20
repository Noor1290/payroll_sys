import { useEffect, useRef, useState } from 'react'
import { checkSavedDates } from '../lib/dates'

// Reads the saved months once, when the dialog opens (`readSaved`: a promise of the store's
// readSavedValues). Nothing is changed by reading them.
//   { step: 'checking' } | { step: 'failed', error } | { step: 'checked', months, dates, unreadable }
export function useSavedValues(readSaved) {
  const [state, setState] = useState({ step: 'checking' })
  const read = useRef(readSaved)

  useEffect(() => {
    let live = true
    read.current().then(
      (answer) => live && setState(answer.ok ? { step: 'checked', months: answer.months, ...checkSavedDates(answer.months) } : { step: 'failed', error: answer.error }),
      (error) => live && setState({ step: 'failed', error: String(error?.message ?? error) })
    )
    return () => {
      live = false
    }
  }, [])

  return state
}
