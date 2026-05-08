# PickleMatch VN UI Context

## 1. Product Summary

PickleMatch VN is a mobile app for discovering, creating, joining, and operating pickleball sessions in Vietnam.

Core user goals:

- browse suitable sessions quickly
- understand booking confidence before joining
- join or request access with low friction
- manage sessions clearly as host
- complete post-match actions without confusion
- track profile progress through Elo, streak, and achievements

## 2. Navigation Structure

### Bottom tabs

Defined in [`app/(tabs)/_layout.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/_layout.tsx):

- `Home` / [`app/(tabs)/index.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/index.tsx)
- `My Sessions` / [`app/(tabs)/my-sessions.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/my-sessions.tsx)
- `Find Session` / [`app/(tabs)/find-session.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/find-session.tsx)
- `Notifications` / [`app/(tabs)/notifications.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/notifications.tsx)
- `Profile` / [`app/(tabs)/profile.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/profile.tsx)

### Non-tab screens

- [`app/create-session.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/create-session.tsx)
- [`app/session/[id].tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/session/[id].tsx)
- [`app/player/[id].tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/player/[id].tsx)
- [`app/rate-session/[id].tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/rate-session/[id].tsx)
- [`app/login.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/login.tsx)
- [`app/profile-setup.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/profile-setup.tsx)
- [`app/skill-assessment.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/skill-assessment.tsx)
- [`app/edit-profile.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/edit-profile.tsx)

## 3. Current Visual Direction

The current UI direction is:

- light background
- clean white cards
- clear hierarchy
- structural use of borders and soft shadows
- consistent iconography via `lucide-react-native`

The visual tone should feel:

- modern
- calm
- premium but practical
- optimized for fast scanning on mobile

## 4. Main Screens

### Home

File:

- [`app/(tabs)/index.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/index.tsx)

Purpose:

- landing screen after login
- quick discovery of active sessions
- fast actions for creating a session or responding to urgent needs

Key UI patterns:

- compact greeting header
- prominent CTA row
- filter pills
- premium session cards

### Find Session

File:

- [`app/(tabs)/find-session.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/find-session.tsx)

Purpose:

- advanced discovery screen
- filter-driven browsing

Key UI patterns:

- search / filter controls
- same session card system as Home
- emphasis on comparability and fast scanning

### My Sessions

File:

- [`app/(tabs)/my-sessions.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/my-sessions.tsx)

Purpose:

- combine hosted sessions and joined sessions
- let users track operational status quickly

Key UI patterns:

- same session card language as discovery surfaces
- role cues for host vs participant
- clear lifecycle state display

### Session Detail

File:

- [`app/session/[id].tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/session/[id].tsx)

This is the heaviest action screen in the app.

Core content:

- court identity
- time and price
- skill range
- booking state
- player list
- pending join requests
- post-match state

Role-specific actions:

- player:
  - join
  - request to join
  - leave
  - rate after match
  - confirm or dispute submitted results
  - report host unprofessional behavior if host fails to close properly
- host:
  - approve or reject requests
  - edit session
  - cancel session
  - confirm booking
  - submit match results

### Create Session

File:

- [`app/create-session.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/create-session.tsx)

Current flow:

1. choose court and time
2. configure session rules
3. review and publish

Key UI responsibilities:

- guide host step by step
- make booking status explicit
- reduce bad publishes by forcing clearer review

### Notifications

File:

- [`app/(tabs)/notifications.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/notifications.tsx)

Purpose:

- in-app inbox
- action recovery
- deep link entry back into sessions and profile

### Profile

Files:

- [`app/(tabs)/profile.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/(tabs)/profile.tsx)
- [`app/edit-profile.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/app/edit-profile.tsx)
- [`components/profile/TrophyRoom.tsx`](/c:/Users/quock/OneDrive/picklematch-vn/components/profile/TrophyRoom.tsx)

Purpose:

- identity
- trust
- progression
- achievements

## 5. Session Card Design Context

The session card is the primary reusable content unit.

It should clearly communicate:

- court name
- time
- booking confidence
- host
- price
- player count
- skill band

Current structure:

1. top row:
   - booking status badge
   - time badge
2. middle:
   - court name
   - address
3. tag row:
   - skill / type
4. footer:
   - host
   - price
   - occupancy

## 6. Important UI States

### Session lifecycle

UI must distinguish:

- `open`
- `pending_completion`
- `done`
- `cancelled`

### Booking lifecycle

UI must distinguish:

- court confirmed
- court unconfirmed

### Join lifecycle

UI must distinguish:

- can join directly
- approval required
- waitlist
- already joined
- request pending

### Post-match lifecycle

UI must distinguish:

- results not submitted
- pending confirmation
- disputed
- finalized
- auto-closed

## 7. Post-Match UI Rules

The post-match UX has been intentionally simplified.

Current rule set:

- host enters results
- players confirm or dispute
- system auto-closes with `draw` if host fails to close on time
- players do not finalize outcomes themselves
- players may report host unprofessional behavior

UI implication:

- avoid multiple competing result entry paths for players
- keep the player action surface narrow and clear
- prefer fallback messaging over complex consensus controls

## 8. Profile and Progression UI

Profile should expose:

- current Elo
- reliability
- placement progress
- streak
- achievements
- history

Important rule:

- displayed skill identity should align with current Elo, not only with the original self-assessment

## 9. Notification UX Context

Important notification-driven flows:

- join request review
- session updates
- pending completion reminders
- auto-closed sessions
- result disputes
- achievement unlocks
- host unprofessional reports

The notification surface should act as a recovery layer for missed actions.

## 10. Design Constraints

When updating UI, preserve these principles:

- mobile-first spacing
- strong visual hierarchy
- avoid emoji-heavy communication
- avoid noisy color usage
- use icons consistently
- keep role-based actions obvious
- reduce ambiguity around booking and post-match state

## 11. Current UX Risk Areas

These flows still need extra care when changing UI:

- `app/session/[id].tsx`
- `app/create-session.tsx`
- `app/rate-session/[id].tsx`
- notification deep links

Reason:

- they combine many states
- they mix product logic with UI state
- they are the most likely places for regression when changing copy or layout
