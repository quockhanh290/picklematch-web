# Fragmentation Audit + Bug-Hunt — Engine/Pipeline + UI/UX (review-only)

Multi-agent read-only audit **with an adversarial bug lens**. Fan out one agent per dimension → each
maps the fragmentation (who-uses-what, where they disagree) **AND flags concrete candidate bugs**
(repro + failure scenario + severity) → an adversarial verify pass tries to REFUTE each candidate
(only CONFIRMED bugs with repro survive) → one synthesis agent dedups, cross-references, and writes a
single prioritized roadmap doc that includes the verified bug list. **No code changes.**

Output: `docs/ENGINE_FRAGMENTATION_AUDIT.md` — fragmentation map + consolidation roadmap + **verified
bugs (with repro)**, one doc.

**Bug lens:** each audit agent returns, besides fragments/disagreements, a `candidate_bugs[]` list —
each `{ title, location, failure_scenario, severity, repro_hint }`. The disagreement points (paths
that give different results, round_no dual-meaning, staleness races) are exactly where latent bugs
live (all of this session's bugs were fragmentation symptoms), so the audit doubles as bug discovery.

## Plan table

| # | Chiều audit | Map gì | Đầu ra chiều |
|---|---|---|---|
| 1 | **Scoring** | `score.ts` (hard-gate INFINITY, gender 4) vs `quality-cost.ts` (soft, gender 0.4): ai dùng ở path nào, chỗ bất đồng, weights | 1 hệ scoring hợp nhất |
| 2 | **Path sinh trận** | Mọi path: suggestNextRound (global) / suggestNextMatch (per-court) / exhaustive-fallback / full-board fill / live-rolling refill / plan-consumption / joint-repartition / ~9 repair pass — khi nào dùng, ra khác nhau ở đâu | Path canonical nên giữ, path retire |
| 3 | **Round-numbering** | `reconstructLiveRounds` (cycle_no→round_no→floor) vs RPC `round_no` vs batch `v_round_no`; `cycle_no` chưa populate; `round_no` đa nghĩa (per-court cycle + key guard "đã chơi vòng này") | 1 mô hình round thống nhất |
| 4 | **Determinism** | Mọi `Date.now()`/wall-clock cut trong search; tie-break không seed; non-determinism dưới áp lực thời gian | Kế hoạch tất định |
| 5 | **Patch inventory** | Catalog special-case: blowout-defer (ALGO 48/54), wait-rescue, forced-tradeoff, joint (55), determinism fast-path (53), repair passes — còn cần hay redundant dưới model hợp nhất | Patch nào retire, cái nào giữ |
| 6 | **Client orchestration** | `useLiveBoard` preview machine: staleness, `liveStateVersionRef`→null, thrash (schedule/cancel/stale), hydrate-stomp, refill trigger, persist-conflict recovery | Kế hoạch robust hóa |
| 7 | **Persist/RPC** | `replace_live_session_suggestions_versioned` + guards, round assign (per-court fix vừa apply), guard "đã chơi vòng này", optimistic-concurrency, snapshot RPC | Consolidation tầng persist |
| 8 | **UI/UX kiến trúc** | "2 thế giới" (controller-hook+api.ts+thin-screen vs supabase-inline-in-screen); god components (NextRoundSuggesterScreenV2, HostMatchScreen, OnboardingScreen); trộn logic/UI; dup type/component (SuggestedLiveMatchRow ×4, buildProjectedStateAfterLiveMatch ×4) | 1 pattern chuẩn (controller+api+thin-render) |
| 9 | **UI/UX design/trải nghiệm** | Nhất quán visual: design-system/NativeWind usage, spacing/typography/màu, component tái dùng vs tự chế, i18n coverage, trạng thái loading/empty/error, luồng host-live (banner/panel/flicker) | Kế hoạch design consistency |
| **S** | **Synthesis** | Đọc toàn bộ 9 finding: dedup + cross-reference (round_no đa nghĩa xuyên #3+#7; staleness xuyên #6+#7; logic/UI mixing #8 chặn khả-năng consolidate engine) → roadmap ưu tiên (hợp nhất gì trước, dependency, rủi ro, cái nào chỉ trị-triệu-chứng) | `docs/ENGINE_FRAGMENTATION_AUDIT.md` |

## Method (3 phase)
- **Phase Audit** (parallel, 9 agents): mỗi agent read-only, trả finding có cấu trúc — `{ dimension, fragments[], disagreements[], candidate_bugs[], consolidation_proposal, severity }`. Verify bằng đọc code trực tiếp + repro khi cần.
- **Phase Verify** (parallel, đối kháng): dedup `candidate_bugs` toàn cục (theo location+title, plain code) → mỗi bug ứng viên 1 agent **cố REFUTE** (mặc định refuted nếu không repro được) → chỉ bug **CONFIRMED (có repro)** mới giữ. Cap top-N theo severity (log số bị bỏ).
- **Phase Synthesize** (1 agent): nhận 9 finding + danh sách bug CONFIRMED → viết `docs/ENGINE_FRAGMENTATION_AUDIT.md` (bảng fragmentation + roadmap ưu tiên + **bug đã verify kèm repro**) → trả summary.
- ~9 audit + N verify (cap) + 1 synthesis, read-only, KHÔNG sửa code.
