import fs from 'node:fs'
import path from 'node:path'
import { toDisplayCourtCycle } from '../../../lib/next-round-suggester/round-numbering'

// P1-10. A stored round_no is 0-based and every place that shows one to a host added its own `+ 1`.
// Five of them, and nothing tied them together — the convention lived in five heads, not one function.
//
// The second test is the part that lasts. Replacing the five call sites is worth little if a sixth grows
// next week, so the rule is enforced rather than described.
describe('one place decides how a stored round number is shown', () => {
  it('shows the first stored round as round 1', () => {
    expect(toDisplayCourtCycle(0)).toBe(1)
    expect(toDisplayCourtCycle(7)).toBe(8)
  })

  it('has no rival formula left in the client', () => {
    const roots = ['features', 'app', 'components']
    const offenders: string[] = []

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue
          walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry.name)) continue
        const source = fs.readFileSync(full, 'utf8')
        source.split('\n').forEach((line, index) => {
          // Any identifier ending in "round"/"Round"/"round_no", plus one. The narrow version of this
          // pattern missed `checkedOutRound + 1` — a value read straight out of round_no under another
          // name — and reported the client clean while a fifth formula was still there.
          if (/\b\w*(?:[Rr]ound|round_no)\s*\+\s*1\b/.test(line)) {
            offenders.push(`${full}:${index + 1}`)
          }
        })
      }
    }

    for (const root of roots) {
      if (fs.existsSync(root)) walk(root)
    }

    expect(offenders).toEqual([])
  })
})
