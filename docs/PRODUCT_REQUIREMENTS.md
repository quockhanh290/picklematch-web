# Product Requirements Description (PRD)

## 1. Product Summary
PickleMatch VN is a mobile app that helps pickleball players in Vietnam discover suitable matches, join or host sessions with higher confidence, and build trust through verifiable post-match outcomes.

The product manages the full grassroots match lifecycle: discover -> join/create -> play -> confirm result -> rate -> progress.

## 2. Problem Statement
Current community play coordination is fragmented across chat groups and manual booking workflows, which leads to:
- Skill mismatch and low-quality matches
- No-shows and weak accountability
- Unclear host operations (booking certainty, join approvals, updates)
- Disputes after matches with no reliable resolution process
- Low long-term engagement due to missing progression loops

## 3. Goals
- Improve match quality with skill-aware matchmaking and smart join flows
- Improve trust with result confirmation, reliability signals, and host accountability
- Improve host efficiency with structured session management and booking status clarity
- Improve retention with Elo progression, streaks, achievements, and profile identity

## 4. Non-Goals (Current Phase)
- Real-money payments and marketplace monetization
- Tournament bracket management
- In-app chat as a primary communication layer
- Advanced social graph features (follows, feeds, comments)

## 5. Target Users
- Players: want fast discovery, fair skill matching, and transparent session outcomes
- Hosts: want low-friction session setup, reliable attendance, and operational control
- Competitive improvers: want measurable progression (Elo, streak, achievements)

## 6. Core Value Proposition
### For players
- Find sessions that better match skill level and schedule
- See clearer booking confidence and session status
- Participate in trust-based result confirmation and fair rating
- Track progress through Elo, streaks, and achievements

### For hosts
- Create and update sessions quickly
- Manage join requests with better decision support
- Communicate booking certainty (`confirmed` vs `unconfirmed`)
- Close sessions via structured post-match flow with accountability

## 7. Functional Requirements
### FR1. Authentication & Onboarding
- OTP phone authentication
- First-time flow must require profile setup and skill assessment before full app access
- Users missing required onboarding fields must be redirected to incomplete onboarding step

### FR2. Skill Initialization & Calibration
- Assign starting skill based on self-assessment and onboarding inputs
- Initialize Elo and provisional state for new players
- Apply stronger calibration impact during early placement matches
- Continuously align visible skill label to current Elo

### FR3. Session Discovery
- Provide discovery surfaces across Home, Find Session, and My Sessions
- Support filtering/search for relevant sessions
- Show clear metadata: date/time, court, skill range, slots, booking status

### FR4. Session Creation & Host Controls
- Multi-step create flow: court, schedule, capacity, skill range, approval mode, booking details
- Hosts can update allowed fields after creation within policy constraints
- Session state transitions must be explicit and auditable

### FR5. Smart Join Flow
- Evaluate join intent into skill-aware states (`MATCHED`, `LOWER_SKILL`, `WAITLIST`)
- Allow direct join where eligible
- Allow request-based join where host approval is required
- Support waitlist fallback when capacity is constrained

### FR6. Booking Trust Signals
- Session must display booking state (`confirmed` or `unconfirmed`)
- Booking state influences UI confidence cues and host operational decisions
- Confirmed bookings should be prioritized in presentation and decision confidence

### FR7. Post-Match Result Lifecycle
- Sessions transition to `pending_completion` after end-time buffer
- Host submits proposed result
- Participants can confirm or dispute
- Result impacts progression only after finalization
- If host does not close in time, system auto-closes with a safe fallback outcome (`draw`)

### FR8. Ratings & Trust Signals
- Support post-match ratings and structured feedback
- Hidden rating reveal policy: reveal after reciprocal rating or reveal timeout
- Update trust-related metrics (reliability, host reputation, no-show impact) from validated outcomes

### FR9. Progression & Retention
- Maintain Elo, placement status, and win/loss outcomes
- Track streaks with inactivity reset policy
- Unlock and surface achievements/trophies
- Present profile progress and historical outcomes clearly

### FR10. Notifications
- Notify users on critical lifecycle events (join request decisions, session updates, pending results, disputes, auto-close, achievements)
- Notification payloads must direct users to the exact resolution screen

## 8. Non-Functional Requirements
- Mobile-first UX with clear hierarchy and fast scanning
- Responsive performance for list-heavy views and cards
- Reliable backend state transitions and idempotent critical operations
- Auditability of session/result changes
- Secure authentication and least-privilege data access controls

## 9. Success Metrics
### Acquisition & Activation
- Onboarding completion rate
- Time-to-first-joined-session

### Match Quality
- % of sessions joined via `MATCHED` outcome
- Dispute rate after host result submission

### Trust & Operations
- Host close-on-time rate
- Auto-close fallback rate
- Confirmed-booking adoption rate

### Retention
- D7 and D30 retention
- Weekly active players and hosts
- Repeat session participation rate

## 10. Release Scope (Current)
Included:
- OTP auth, onboarding, and skill initialization
- Session discovery, create, join, and management
- Booking status model
- Post-match result confirmation/dispute flow with auto-close fallback
- Elo/streak/achievement profile loops
- Notifications for core operational events

Deferred:
- Hidden rating auto-finalize automation hardening (if background processor is not fully operational)

## 11. Risks & Mitigations
- Risk: Hosts delay closure, causing stale session outcomes
  - Mitigation: pending-completion reminders + deterministic auto-close fallback
- Risk: Perceived unfair skill assignment for new users
  - Mitigation: provisional mode with strong early calibration and transparent progression
- Risk: Trust erosion from inconsistent booking certainty
  - Mitigation: explicit booking state and clear session confidence signals

## 12. Acceptance Criteria
- New users cannot bypass required onboarding and skill setup
- Session join outcomes follow smart-join policy and state correctness
- Post-match flow enforces host submit + participant confirm/dispute + fallback auto-close
- Progression updates only after finalized result state
- Notifications are triggered for all mandatory lifecycle events
- Core trust signals (reliability/reputation) update according to finalized outcomes
