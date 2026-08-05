# Forced-Court Tradeoff — Plan 3: Client UI (3-way panel)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. This plan touches a large existing component + is UI-heavy — the deliverable is validated by characterization tests + the host's visual QA after Plans 1-2 are deployed.

**Goal:** Render the forced-court 3-way decision on the suggested-match card from the new `match.forced_tradeoff` (2 Pareto endpoints) + `match.wait_rescue_options` (verified wait), replacing the generic tradeoff-choices menu. Host picks **① Chờ Sân Y / ② Chịu lặp (default) / ③ Chịu lệch**; the displayed lineup swaps accordingly; the choice persists.

**Architecture:** The card `SuggestedLiveMatchCard` (`features/host/session-detail/next-round-v2/components/ScreenComponents.tsx`) ALREADY has a unified decision panel (`decisionCards` builder, ~line 2003-2064: "Chơi luôn / Đổi sang: X / Chờ sân khác xong"). This plan **re-sources** that builder from the forced-tradeoff data model instead of `tradeoff_choices`/`rescue_court_idxs`, and swaps the displayed lineup between the two endpoints. The re-suggest for "Chờ" reuses the existing wait-rescue flow in `useLiveBoard`. No new panel skeleton is built.

**Prereq for QA:** Plans 1-2 deployed (edge v-next + migration applied) so real forced courts emit `forced_tradeoff`/`wait_rescue_options` — otherwise the panel has no data to render. Code + unit/characterization tests do not need the deploy; visual QA does.

## Global Constraints

- **Flag-gated data:** the panel's new source (`match.forced_tradeoff`) is only present under `SESSION_QUALITY_COST_MODEL` for forced courts. When absent, the card renders exactly as today (a clean court shows the plain lineup, no panel). Non-forced / flag-OFF behavior must be unchanged.
- **Default = ② Chịu lặp:** the displayed lineup defaults to `forced_tradeoff.acceptRepeat`; starting without interacting uses it.
- **Persist the choice:** the host's selection (which endpoint / wait) must survive re-render + reload (reuse the existing `hostSelectedRef`/persist path the card already uses for tradeoff selection).
- **Remove the generic menu:** the 4-option `buildLiveTradeoffChoices` menu (`tradeoff_choices`) is retired from the card for forced courts — the 2 endpoints replace it. Leave the non-forced `tradeoff_choices` path only if a clean court still legitimately uses it; otherwise remove. (Confirm during implementation whether any clean-court path still populates `tradeoff_choices` post-Plan-1; if the engine now only emits endpoints, delete the dead menu code.)
- **Tests:** characterization tests in `tests/host-live/` (React Testing Library, jest). Never run the simulation suite. Run touched test files with `--runInBand`.

## Reference — the existing decision panel to adapt

`ScreenComponents.tsx:2003-2064` builds `decisionCards: {key,testId,tone,title,result,cost,selected,onPress}[]`:
- **play** (`tone:'play'`) — "Chơi luôn", selects the recommended/current lineup.
- **swap** (per `swapChoices`) — "Đổi sang: <choice>", selects an alternative lineup.
- **wait** (`showDegradedRescue`) — "Chờ sân khác xong", sets `waitSelected`.
Selection state: `selectedChoiceId` (which lineup) + `waitSelected` (wait vs play). The displayed lineup derives from `selectedChoice.alternative` (~line 1806, `visibleMatch`).

---

### Task 1: Re-source the decision panel from `forced_tradeoff` + `wait_rescue_options`

**Files:**
- Modify: `features/host/session-detail/next-round-v2/components/ScreenComponents.tsx` (the `SuggestedLiveMatchCard` decision-panel region, ~1767-2064)
- Test: `tests/host-live/forced-tradeoff-panel.test.tsx` (create)

**Interfaces:**
- Consumes: `match.forced_tradeoff` (`{ acceptRepeat: {team_a,team_b}; acceptImbalance: {team_a,team_b} }`) + `match.wait_rescue_options` (`{court_idx, started_at}[]`) — typed in Plan 2.
- Produces: an adapted `decisionCards` builder + a `forcedSelection` state (`'accept_repeat' | 'accept_imbalance' | 'wait'`, default `'accept_repeat'`) driving which lineup the card displays.

- [ ] **Step 1: Write the failing characterization test**

Create `tests/host-live/forced-tradeoff-panel.test.tsx` (model on the existing `tests/host-live/characterization/wait-rescue-banner.test.tsx` for the card render harness + how a `match` with degraded fields is passed). Build a `match` with `forced_tradeoff` (distinct acceptRepeat/acceptImbalance) + `wait_rescue_options: [{court_idx:2, started_at:...}]` and assert:
```tsx
// renders 3 decision options for a forced court
it('shows Chịu lặp (default, selected) + Chịu lệch + Chờ Sân 3 for a forced court', () => {
  // render SuggestedLiveMatchCard with the forced match
  expect(screen.getByTestId(/decision-.*repeat/)).toBeTruthy()   // ② Chịu lặp
  expect(screen.getByTestId(/decision-.*imbalance/)).toBeTruthy()// ③ Chịu lệch
  expect(screen.getByText(/Chờ Sân 3/)).toBeTruthy()             // ① wait (court_idx 2 → "Sân 3")
  // default selection = accept_repeat, displayed lineup = acceptRepeat's teams
})
it('tapping Chịu lệch swaps the displayed lineup to acceptImbalance', () => { /* fireEvent + assert lineup text */ })
it('a court with NO forced_tradeoff renders the plain lineup, no decision panel', () => { /* undefined → no panel */ })
```
Assert the displayed lineup (player names/pvna) matches the selected endpoint's teams. Use the existing card's testIDs (`nrv2-decision-*`) adapted to the new keys (`accept_repeat`/`accept_imbalance`/`wait`).

- [ ] **Step 2: Run to verify fail**

Run: `npx jest tests/host-live/forced-tradeoff-panel.test.tsx --runInBand` — FAIL (panel still sourced from `tradeoff_choices`; the forced match has none).

- [ ] **Step 3: Implement the re-source**

In `SuggestedLiveMatchCard`:
- Add `const forced = match.forced_tradeoff` and `const forcedWait = match.wait_rescue_options ?? []`.
- Add state `const [forcedSelection, setForcedSelection] = useState<'accept_repeat'|'accept_imbalance'|'wait'>('accept_repeat')`.
- When `forced` is present, compute the DISPLAYED lineup from the selection: `accept_repeat → forced.acceptRepeat`, `accept_imbalance → forced.acceptImbalance`, `wait → acceptRepeat` (wait keeps the default lineup pending the re-suggest). Feed this into the existing `visibleMatch`/lineup render path (override `team_a`/`team_b`).
- Rebuild `decisionCards` for the forced case (guard `if (forced)`), replacing the `tradeoff_choices`-derived entries:
  - **② Chịu lặp** (`key:'accept_repeat'`, tone `'play'`): result `"cân (chênh ${gap})"`, cost `"${người} gặp lại ${đối} lần ${n}"` (derive gap + repeat from `forced.acceptRepeat`'s teams via the same pvna/repeat helpers the card already uses). Selected when `forcedSelection==='accept_repeat'`. Default.
  - **③ Chịu lệch** (`key:'accept_imbalance'`, tone `'swap'`): result `"tươi (không lặp)"`, cost `"đội lệch ${gap}"`. Selected when `'accept_imbalance'`.
  - **① Chờ Sân Y** (`key:'wait'`, tone `'wait'`): render ONLY if `forcedWait.length > 0`; title `"Chờ Sân ${forcedWait[0].court_idx + 1}"`, result `"xong sẽ xếp sạch được"`, cost derived (longest-running hint from `started_at` if desired). Selected when `'wait'`. `onPress` sets `forcedSelection='wait'` AND triggers the existing wait re-suggest path (see Task 2).
- Keep the non-forced path (clean court) exactly as today.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/host-live/forced-tradeoff-panel.test.tsx --runInBand` — PASS.

- [ ] **Step 5: Commit**

```bash
git add features/host/session-detail/next-round-v2/components/ScreenComponents.tsx tests/host-live/forced-tradeoff-panel.test.tsx
git commit -m "feat(host-live): 3-way forced-court decision panel from forced_tradeoff data"
```

---

### Task 2: Wire "Chờ Sân Y" to the verified wait re-suggest + persist the choice

**Files:**
- Modify: `features/host/session-detail/next-round-v2/hooks/useLiveBoard.ts` (the wait-rescue re-suggest path) and/or `ScreenComponents.tsx` (persist the selection)
- Test: `tests/host-live/forced-tradeoff-panel.test.tsx` (extend) or a `useLiveBoard` hook test

**Interfaces:**
- Consumes: the existing wait-rescue re-suggest mechanism in `useLiveBoard` (search for `rescue`, `Chờ`, `degraded` re-suggest — the flow that, on "Chờ Sân X", waits for the rescue court then re-suggests). Re-point it at `wait_rescue_options` (the verified list) instead of `rescue_court_idxs`.

- [ ] **Step 1: Write the failing test**

Extend the panel test: tapping "Chờ Sân 3" marks the court awaiting the verified rescue court (court_idx 2) — assert the card enters the waiting state (e.g. a "đang chờ Sân 3" indicator or the existing wait-selected visual) and does NOT start the match. If the re-suggest trigger is in `useLiveBoard`, add a focused hook test asserting the wait targets `wait_rescue_options[0].court_idx`.

- [ ] **Step 2-4: Implement + verify**

- Persist `forcedSelection` the same way the card already persists a tradeoff choice (reuse `hostSelectedRef` + whatever writes the chosen lineup on Start). On **Bắt đầu**, the started lineup = the currently-displayed endpoint (acceptRepeat / acceptImbalance).
- For **wait**: reuse the existing `useLiveBoard` wait-rescue re-suggest, but source the target court from `wait_rescue_options` (verified) — when that court completes, the board re-suggests this court (which, per Plan 1, now has a clean fill available, so the panel disappears). This directly fixes the host's "Chờ Sân X kẹt" complaint by only ever offering verified-clean waits.
- Run the panel + any touched host-live tests `--runInBand`; run `npm run typecheck:guard`.

- [ ] **Step 5: Commit**

```bash
git add features/host/session-detail/next-round-v2/hooks/useLiveBoard.ts features/host/session-detail/next-round-v2/components/ScreenComponents.tsx tests/host-live/forced-tradeoff-panel.test.tsx
git commit -m "feat(host-live): wire Chờ Sân Y to verified wait re-suggest + persist forced choice"
```

---

### Task 3: Retire the generic tradeoff-choices menu + regression sweep

**Files:**
- Modify: `ScreenComponents.tsx` (remove the now-dead `tradeoff_choices` menu rendering for forced courts); possibly `lib/next-round-suggester/live-preview.ts` (if `buildLiveTradeoffChoices` output is now fully unused — confirm first, do NOT delete if a clean-court path still populates it)
- Test: run the existing host-live characterization suite

- [ ] **Step 1: Confirm what still uses `tradeoff_choices`**

Grep `tradeoff_choices` / `tradeoffChoices` across `features/` + `lib/`. If, post-Plan-1, the engine only emits `forced_tradeoff` (no `tradeoff_choices`), remove the dead menu rendering + the now-unused `selectedChoiceId`/`swapChoices` code paths from the card. If a clean court still legitimately shows `tradeoff_choices` (e.g. an over-tolerance-but-not-forced tradeoff), leave that path and only remove the forced-court overlap. Document the decision in the commit.

- [ ] **Step 2: Regression**

Run the host-live characterization tests touching the card:
`npx jest tests/host-live/characterization/wait-rescue-banner.test.tsx tests/host-live/characterization/preview-happy-path.test.tsx tests/host-live/forced-tradeoff-panel.test.tsx tests/host-live/forced-tradeoff-rehydrate.test.ts --runInBand`
Then `npm run typecheck:guard` and `npm run lint:errors`.
Expected: green; update any characterization snapshot that legitimately changed due to the panel re-source (review the diff — it must reflect the intended new panel, not an accident).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(host-live): retire generic tradeoff-choices menu superseded by forced-court panel"
```

---

## Self-Review

**Spec coverage:** Task 1 = the 3-way panel from the two Pareto endpoints (spec §UI "① Chờ / ② Chịu lặp / ③ Chịu lệch", default ②). Task 2 = verified-wait wiring (spec: "Chờ Sân Y" from `wait_rescue_options`, fixes the stuck-rescue complaint) + persist the host's decision. Task 3 = retire the generic menu (spec §Non-goals "the generic 4-option alternatives menu is removed"). Clean courts unchanged (spec: "Clean courts keep the plain single-lineup card").

**Placeholder scan:** the JSX-level changes are described against the existing `decisionCards` builder (line-referenced) rather than transcribed verbatim — deliberate for a refactor of a large existing component; the data mapping, testIDs, state, and default are concrete. Test assertions are concrete. Implementation reads the existing card region first.

**Type consistency:** `forced_tradeoff`/`wait_rescue_options` shapes match Plan 2's client types; `forcedSelection` union is `'accept_repeat'|'accept_imbalance'|'wait'`; displayed lineup always derives from the selected endpoint.

**Note:** this plan's deliverable needs the host's **visual QA** (panel copy, layout, the swap interaction) after Plans 1-2 are deployed — flagged in the header. The characterization tests prove the data→render wiring; they do not replace looking at it on-device.
