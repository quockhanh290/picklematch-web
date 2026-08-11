// P1-10: one place decides how a stored round number becomes the one a host reads.
//
// Two concepts travel under the name "round" and only one of them belongs on screen:
//
//   court cycle — session_live_matches.round_no, how many times THIS court has turned over. Stored
//     0-based, shown 1-based. Per-court since migration 20260808000001, so it says nothing about how
//     one court's progress compares to another's.
//
//   session position — session_live_matches.sequence_no, unique and increasing across the whole
//     session. This is what recency and ordering must use. It is deliberately absent from this module:
//     it is never something to display, and every attempt to derive one from the other has been a bug.
//
// The +1 used to live at five call sites with nothing tying them together.

export function toDisplayCourtCycle(storedRoundNo: number): number {
  return storedRoundNo + 1
}
