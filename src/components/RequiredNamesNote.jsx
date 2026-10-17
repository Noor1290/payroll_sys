import { whoNeeds } from '../lib/requiredNames'

const quote = (names) => names.map((n) => `“${n}”`).join(' and ')

// The required names that are missing or written differently (rehearsal fix F4), in plain words.
// `problems` from checkRequiredNames; `closing` is the sentence that ends the note.
export default function RequiredNamesNote({ problems, closing }) {
  if (problems.length === 0) return null
  const missing = problems.filter((p) => p.kind === 'missing')
  const capitals = problems.filter((p) => p.kind === 'capitals')
  const shared = problems.filter((p) => p.kind === 'shared')
  return (
    <div data-testid="required-names" role="note" className="note note-warn space-y-1 text-sm">
      <p className="font-medium">Names the dashboard and the payslip app look for</p>
      {missing.length > 0 && <p>Missing: {missing.map((p) => `${p.name} (${whoNeeds(p)})`).join(', ')}.</p>}
      {capitals.map((p) => (
        <p key={p.name}>
          {quote(p.found)} should be written “{p.name}” ({whoNeeds(p)}).
        </p>
      ))}
      {shared.map((p) => (
        <p key={p.name}>
          Two columns are called “{p.name}”, so they go out as {quote(p.found)}, and “{p.name}” itself is missing ({whoNeeds(p)}). Rename one of them.
        </p>
      ))}
      <p>{closing}</p>
    </div>
  )
}
