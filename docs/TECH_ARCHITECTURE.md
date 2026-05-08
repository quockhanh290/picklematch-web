# PickleMatch VN Technical Architecture

## 1. Stack

### Frontend

- React Native
- Expo Router
- TypeScript
- NativeWind
- lucide-react-native

### Backend

- Supabase Auth
- Supabase Postgres
- SQL migrations
- RPC functions
- RLS policies

## 2. Codebase Structure

Main folders:

- `app/`
- `components/`
- `lib/`
- `hooks/`
- `supabase/migrations/`
- `supabase/functions/`
- `scripts/`

## 3. Navigation Architecture

### Tab screens

- `app/(tabs)/index.tsx`
- `app/(tabs)/find-session.tsx`
- `app/(tabs)/my-sessions.tsx`
- `app/(tabs)/notifications.tsx`
- `app/(tabs)/profile.tsx`

### Non-tab screens

- `app/login.tsx`
- `app/profile-setup.tsx`
- `app/skill-assessment.tsx`
- `app/create-session.tsx`
- `app/session/[id].tsx`
- `app/player/[id].tsx`
- `app/edit-profile.tsx`
- `app/rate-session/[id].tsx`

## 4. Shared UI Layer

### Design primitives

- `components/design/AppButton.tsx`
- `components/design/AppChip.tsx`
- `components/design/AppInput.tsx`
- `components/design/AppStatCard.tsx`
- `components/design/EmptyState.tsx`
- `components/design/ScreenHeader.tsx`
- `components/design/SectionCard.tsx`
- `components/design/StatusBadge.tsx`
- `lib/designSystem.ts`

### Session components

- `components/session/FeedMatchCard.tsx`
- `components/session/SmartJoinButton.tsx`
- `components/session/JoinRequestModal.tsx`
- `components/session/HostRequestReview.tsx`

### Profile components

- `components/profile/TrophyRoom.tsx`

## 5. Core Data Model

### Main tables

- `players`
- `sessions`
- `session_players`
- `join_requests`
- `courts`
- `court_slots`
- `ratings`
- `notifications`
- `player_stats`
- `player_achievements`

### `players`

Responsibilities:

- public profile
- self-assessed level
- current Elo
- reliability
- host reputation
- provisional state
- placement progress
- earned badge mirror

Important fields:

- `self_assessed_level`
- `skill_label`
- `elo`
- `current_elo`
- `is_provisional`
- `placement_matches_played`
- `reliability_score`
- `host_reputation`
- `earned_badges`

### `sessions`

Responsibilities:

- host ownership
- session configuration
- booking state
- post-match state
- result confirmation state

Important fields:

- `host_id`
- `slot_id`
- `elo_min`
- `elo_max`
- `max_players`
- `status`
- `require_approval`
- `court_booking_status`
- `results_status`
- `results_submitted_at`
- `results_confirmation_deadline`
- `pending_completion_marked_at`
- `completion_reminder_sent_at`
- `auto_closed_at`
- `auto_closed_reason`

### `session_players`

Responsibilities:

- session membership
- confirmed / pending participation
- match result
- proposed result
- confirmation / dispute state
- host reporting metadata

Important fields:

- `session_id`
- `player_id`
- `status`
- `match_result`
- `proposed_result`
- `result_confirmation_status`
- `result_confirmed_at`
- `result_disputed_at`
- `result_dispute_note`
- `host_unprofessional_reported_at`
- `host_unprofessional_report_note`

### `join_requests`

Responsibilities:

- approval-based join flow
- intro note
- host reply template

### `ratings`

Responsibilities:

- player conduct
- host quality
- hidden reveal flow
- peer review signal for calibration

### `notifications`

Responsibilities:

- inbox
- unread badge
- deep link routing

### `player_stats`

Responsibilities:

- total matches
- total wins
- current streak
- max streak
- host average rating
- streak decay metadata

### `player_achievements`

Responsibilities:

- persisted unlocked achievements
- earned date
- category
- icon
- metadata

## 6. Frontend Ownership

Screens with the most orchestration logic:

- `app/create-session.tsx`
- `app/session/[id].tsx`
- `app/rate-session/[id].tsx`
- `app/(tabs)/profile.tsx`

Core helpers:

- `lib/skillAssessment.ts`
- `lib/matchmaking.ts`
- `lib/notifications.ts`
- `lib/supabase.ts`

## 7. Matchmaking Architecture

Smart join currently uses:

- self-assessed level mapping
- Elo range mapping
- available spots
- auto-accept / require approval

Current statuses:

- `MATCHED`
- `LOWER_SKILL`
- `WAITLIST`

Primary orchestration lives in `app/session/[id].tsx`.

## 8. Skill Calibration Architecture

### Frontend input

`app/rate-session/[id].tsx` submits:

- `skill_validation = weaker`
- `skill_validation = matched`
- `skill_validation = outclass`

### Backend source of truth

Main migrations:

- `20260324_upgrade_rating_system.sql`
- `20260324_update_skill_calibration_engine.sql`

Main functions:

- `process_final_ratings(uuid)`
- `apply_session_skill_calibration(uuid, uuid)`
- `get_skill_label_for_elo(integer)`

### Current behavior

- ratings create peer review data
- finalized match result provides the technical outcome
- backend uses both signals to update Elo
- provisional players get stronger calibration in their first 5 placement matches
- `skill_label` is synced from current Elo

## 9. Rating Pipeline

### Frontend

`app/rate-session/[id].tsx`:

- loads ratable players
- collects positive / negative tags
- supports no-show
- supports skill validation
- submits hidden ratings

### Backend

`process_final_ratings(...)`:

- assigns `reveal_at`
- reveals ratings when conditions are met
- updates reliability
- updates host reputation
- applies skill calibration
- updates badge mirror

### Reveal model

- hidden on insert
- visible on mutual rating or after the reveal window

### Deferred item

Cron-based background processing exists in preparation but is still not rolled out:

- `supabase/functions/process-pending-ratings/index.ts`
- `supabase/migrations/20260324_add_pending_ratings_processor.sql`

## 10. Result Confirmation Pipeline

### Purpose

Prevent one-sided host result finalization.

### Core functions

From `20260324_add_result_confirmation_flow.sql`:

- `submit_session_results(uuid, jsonb)`
- `respond_to_session_result(uuid, text, text)`
- `finalize_session_results(uuid)`

### Current flow

1. Host submits proposed results.
2. Players confirm or dispute.
3. Only finalized results become official.
4. Achievement and calibration run after finalization.

### Frontend orchestration

`app/session/[id].tsx`:

- host submits proposed results
- players confirm or dispute
- fallback query path protects the screen when local DB schema lags behind

## 11. Post-Match Lifecycle Pipeline

### Pending completion

From `20260324_add_pending_completion_flow.sql`:

- session moves from `open` to `pending_completion`
- trigger condition is effectively `end_time + buffer`
- host gets a reminder notification

Main function:

- `process_pending_session_completions(uuid default null)`

### Hard auto-close

From `20260324_add_hard_auto_close_flow.sql`:

- overdue sessions auto-close
- fallback result becomes `draw`
- host gets a light penalty
- players are notified that the session is ready for post-match actions

Main function:

- `process_overdue_session_closures(uuid default null)`

### Host professionalism reporting

From `20260324_simplify_post_match_reporting.sql`:

- players no longer report final match outcomes
- players can only report host unprofessional behavior
- host reputation receives a light penalty

Main function:

- `report_host_unprofessional(uuid, text)`

Deprecated safeguard kept intentionally:

- `report_session_outcome(...)` now raises an exception to block stale flows

## 12. Achievement Pipeline

### Main migration

- `20260324_add_achievement_system.sql`

### Main functions

- `recompute_player_stats(uuid)`
- `award_achievement(...)`
- `check_achievements(uuid)`

### Behavior

- recomputes player stats
- applies streak decay
- awards achievements idempotently
- creates achievement notifications

## 13. Notification Architecture

Notifications are stored in `notifications` and used as the in-app inbox.

Common types include:

- `join_request`
- `join_approved`
- `join_rejected`
- `player_left`
- `session_cancelled`
- `session_updated`
- `session_pending_completion`
- `session_auto_closed`
- `host_unprofessional_reported`
- `achievement_unlocked`

## 14. Current Technical Notes

- `app/session/[id].tsx` remains the heaviest orchestration screen in the app.
- Schema-aware fallback logic is already in place for session detail fetches.
- The post-match system is now intentionally simpler:
  - host submits results
  - players confirm / dispute
  - system auto-closes with `draw` if needed
  - players may report host behavior, but do not finalize outcomes themselves
