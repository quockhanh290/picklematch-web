# PickleMatch VN - Complete Mock Design Brief

## 1) Master Prompt (All Screens)

```text
Design a complete, high-fidelity mobile app mock for “PickleMatch VN” (Vietnamese pickleball booking + matchmaking app). The output must include ALL major screens, states, and realistic UI content so the mock is immediately reviewable by product, design, and engineering.

PRODUCT CONTEXT
PickleMatch VN helps players find suitable sessions, join/host matches, confirm results after games, and track progression (Elo, streak, achievements).
Core loop: Discover match -> Join/Create -> Play -> Submit/Confirm result -> Rate -> Progress.

PRIMARY USERS
- Player: wants fast, fair, clear match selection.
- Host: wants fast session setup, clear booking confidence, manageable join approvals.
- Returning user: wants visible progression and trust signals.

VISUAL DIRECTION: “COURT SIGNAL”
- Tone: sport-broadcast + booking utility, premium but practical.
- Fast scanning is the #1 priority.
- One dominant CTA per screen.
- Urgency and booking confidence must be obvious at a glance.

COLOR TOKENS (MANDATORY)
- bg.canvas: #F7F4EE
- bg.surface: #FFFDF9
- bg.surfaceAlt: #F1ECE3
- text.primary: #1E1F22
- text.secondary: #5A5F66
- text.muted: #8A9099
- border.soft: #DED7CC
- border.strong: #C9C0B2
- brand.primary (CTA): #D24A0F
- brand.primaryHover: #B83F0B
- brand.primarySoft: #FCE5DA
- accent.confirmed: #0E8A7A
- accent.confirmedSoft: #D9F2EE
- accent.info: #2E6FD8
- accent.infoSoft: #E3ECFF
- state.warning: #C67A00
- state.warningSoft: #FCECC8
- state.error: #C62828
- state.errorSoft: #FDE2E2
- urgency.high: #E4572E
- urgency.medium: #F3A712
- urgency.low: #0E8A7A

TYPOGRAPHY
- Heading/display: bold condensed-style sans.
- UI/body: clean geometric sans.
- Use uppercase only for tiny labels/chips.
- Vietnamese copy across all screens.

LAYOUT + STYLE RULES
- Large rounded corners.
- Thin borders.
- Minimal shadows.
- Clean spacing and strong visual rhythm.
- Metadata chips mostly neutral.
- Color chips only for semantic status (urgency/confirmed/error).

SESSION CARD SPEC (USE THIS EVERYWHERE CONSISTENTLY)
- Row 1: Court name + urgency pill (example: “Còn 1 ch?”).
- Row 2: Neutral chips: date, time, level.
- Row 3: Compatibility signal bar + value (example: “87% phù h?p”).
- Row 4: Host avatar + host name/role + price (/ngu?i).
- Row 5: Full-width primary CTA button (“Vào kèo ngay”).
- Must have variants: normal, almost full, full/waitlist, booked-confirmed, booked-unconfirmed.

SMART JOIN STATES (MUST VISUALIZE)
- MATCHED: direct join.
- LOWER_SKILL: request to join.
- WAITLIST: register standby.
- Make state differences obvious in badge + CTA text + supporting copy.

BOOKING TRUST STATES (MUST VISUALIZE)
- Ðã d?t sân (confirmed): teal semantic.
- Chua d?t sân (unconfirmed): warning semantic.
- Show these as independent from urgency.

POST-MATCH FLOW STATES (MUST VISUALIZE)
- pending_completion
- result_submitted_pending_confirmation
- disputed
- finalized
- auto-closed draw fallback
Include user-facing messages and action buttons for each.

REQUIRED SCREENS (DESIGN ALL)
1. Splash
2. Login (phone + OTP)
3. Onboarding intro
4. Skill assessment step flow
5. Home dashboard
6. Find Match list
7. Advanced filter modal
8. Session detail
9. Smart join decision sheet/modal
10. Create session step 1 (court + time)
11. Create session step 2 (slots + level + approval + booking state)
12. Create session step 3 (review + publish)
13. My Sessions (tabs: Ðang host / Ðã tham gia / L?ch s?)
14. Host review join requests
15. Pending post-match actions inbox
16. Host submit result
17. Player confirm/dispute result
18. Rate match / feedback
19. Notifications
20. Profile overview
21. Edit profile
22. Trophy room / achievements
23. Public player profile
24. Empty states set
25. Error/retry states
26. Loading/skeleton states

BOTTOM NAV + GLOBAL PATTERNS
- Bottom tabs: Trang ch?, Kèo c?a tôi, Tìm kèo, Thông báo, H? so.
- Floating create CTA where relevant (“T?o kèo m?i”).
- Sticky bottom action button only on high-intent screens.
- Use consistent header with search/filter/back patterns.

REALISTIC VIETNAMESE COPY EXAMPLES
Use practical app copy like:
- “Tìm kèo”
- “Vào kèo ngay”
- “Ðã d?t sân”
- “Còn 1 ch?”
- “Ch? xác nh?n”
- “Xác nh?n k?t qu?”
- “Báo có tranh ch?p”
- “Ðánh giá sau tr?n”
- “Không tìm th?y kèo phù h?p”

DATA REALISM
Use believable session data:
- Court names in Hanoi/HCMC style.
- Time slots like 07:00–09:00, 18:30–20:30.
- Level ranges like 2.5–4.0.
- Prices in VND shorthand like 80k/ngu?i, 120k/ngu?i.
- Participant counts like 3/4, 7/8.

COMPONENT LIBRARY DELIVERABLE (INCLUDED IN OUTPUT)
- Buttons: primary/secondary/ghost/disabled/loading.
- Chips: neutral + semantic states.
- Cards: session card variants.
- Inputs: search, text, phone, OTP.
- Modals/sheets/dialogs.
- Tabs/segmented controls.
- Avatars/badges/progress bars.
- Toast/snackbar/inline alerts.

MOTION GUIDANCE
- Press feedback: 120–180ms.
- Standard transitions: 180–240ms.
- Modal fade, sheet slide.
- Keep motion functional, not decorative.

OUTPUT FORMAT
- A complete mobile design kit with:
- Token sheet.
- Type scale.
- Spacing/radius/elevation guidance.
- Component set.
- All required screens in one coherent style.
- Light + dark optional only if fully consistent (otherwise light mode only).
- Must look shippable, not concept-only.
```

## 2) Screen-by-Screen Content Matrix

### Global Sample Data
- Player: `Nguy?n Anh`, ELO `1532`, Level `3.5`, City `Hà N?i`, Reliability `92%`
- Host: `Tr?n Minh`, Host score `4.7`, Hosted `38`
- Court A: `Sân B?c T? Liêm`, `Q. B?c T? Liêm, Hà N?i`
- Court B: `Sân C?u Gi?y Arena`, `Q. C?u Gi?y, Hà N?i`
- Session 1: `T7 15/06`, `07:00–09:00`, `Level 3.5`, `80k/ngu?i`, `3/4`, `87% phù h?p`, `Còn 1 ch?`, booking `Ðã d?t sân`
- Session 2: `CN 16/06`, `18:30–20:30`, `Level 3.0–4.0`, `120k/ngu?i`, `7/8`, `78% phù h?p`, `S?p d?y`, booking `Chua d?t sân`
- Session 3: `T2 17/06`, `20:00–22:00`, `Level 2.5–3.5`, `70k/ngu?i`, `8/8`, waitlist only
- Notification samples: `Yêu c?u tham gia m?i`, `K?t qu? tr?n c?n xác nh?n`, `B?n m? khóa danh hi?u m?i`

1. Splash  
Fields: App logo, app name `PickleMatch VN`, tagline `Tìm kèo chu?n trình`, loading label `Ðang t?i...`.

2. Login (Phone + OTP)  
Fields: Phone input `+84 9xx xxx xxx`, OTP 6 cells, primary CTA `Xác nh?n`, secondary `G?i mã OTP`, helper `Mã OTP dã g?i t?i +84...`.

3. Onboarding Intro  
Fields: Title `B?t d?u hành trình`, description `7 câu h?i d? u?c lu?ng trình d?`, CTA `Làm bài dánh giá`, secondary `Ð? sau`.

4. Skill Assessment (Step Flow)  
Fields: Step counter `Câu 2/7`, question title, 4 options, progress bar %, CTA `Ti?p theo`, back `Quay l?i`.

5. Home Dashboard  
Fields: Greeting `Chào Nguy?n Anh`, status line `Hôm nay ra sân ch??`, streak card `7 ngày`, sections `Vi?c b?n c?n x? lý`, `Dành riêng cho b?n`, session carousel cards.

6. Find Match List  
Fields: Header `Tìm kèo`, search placeholder `Tìm sân, qu?n, gi?...`, quick chips `Hôm nay`, `Level 3.0+`, `Du?i 100k`, list of session cards, sticky CTA `L?c nâng cao`.

7. Advanced Filter Modal  
Fields: Date range, time slots, district, level range slider, price slider, booking toggle `Ch? hi?n kèo dã d?t sân`, reset `Ð?t l?i`, apply `Áp d?ng b? l?c`.

8. Session Detail  
Fields: Court hero, date/time, level, booking state, slots, host profile row, participants list, rules, map snippet, CTA state-based `Vào kèo ngay` or `G?i yêu c?u`.

9. Smart Join Decision Sheet  
Fields: State badge `MATCHED` / `LOWER_SKILL` / `WAITLIST`, short explanation, risk note, CTA `Vào kèo`, `Xin vào kèo`, `Ðang ký d? b?`.

10. Create Session Step 1 (Court + Time)  
Fields: Court picker, date picker, start/end time, duration preview, CTA `Ti?p t?c`.

11. Create Session Step 2 (Slots + Level + Rules)  
Fields: Total slots, skill level/range, join mode `Duy?t th? công`, booking state selector, notes field, CTA `Ti?p t?c`.

12. Create Session Step 3 (Review + Publish)  
Fields: Summary card, price breakdown per player, warnings, checkbox `Tôi xác nh?n thông tin dúng`, CTA `Ðang kèo`.

13. My Sessions (Tabs)  
Fields: Tabs `Ðang host`, `Ðã tham gia`, `L?ch s?`, segmented filter chips, list cards with status badges `open`, `pending_completion`, `done`.

14. Host Review Join Requests  
Fields: Request cards with avatar, requester level/ELO, fit score, note, actions `Duy?t`, `T? ch?i`, quick reason chips.

15. Pending Post-Match Inbox  
Fields: Section `Sau tr?n`, cards needing action, countdown `Còn 10 gi? d? ch?t`, CTA `Nh?p k?t qu?`.

16. Host Submit Result  
Fields: Team A/B scores, winner selector, evidence note field, summary preview, CTA `G?i k?t qu?`.

17. Player Confirm / Dispute Result  
Fields: Proposed result card, agree/disagree options, dispute reason presets, free text box, CTAs `Xác nh?n`, `Báo tranh ch?p`.

18. Rate Match / Feedback  
Fields: Opponent rating (1–5), host quality tags, sportsmanship tags, no-show toggle, CTA `G?i dánh giá`.

19. Notifications  
Fields: Grouped by time `Hôm nay`, `Hôm qua`, unread indicators, event icon, short message, deep-link CTA row.

20. Profile Overview  
Fields: Cover/hero, name, ELO, level label, reliability, win rate, matches played, buttons `S?a h? so`, `Xem danh hi?u`.

21. Edit Profile  
Fields: Avatar uploader, name, city, preferred courts, play preference, bio, CTA `Luu thay d?i`.

22. Trophy Room / Achievements  
Fields: Progress summary, category tabs `Ti?n b?`, `Hi?u su?t`, `K? lu?t`, trophy cards with locked/unlocked states.

23. Public Player Profile  
Fields: Name, level, ELO, reliability, recent results list, community feedback summary, shared courts.

24. Empty States  
Fields: Illustration placeholder, title, single-line helper text, recovery CTA.  
Examples: `Chua có kèo phù h?p`, `B?n chua có thông báo`, `Chua m? khóa danh hi?u`.

25. Error / Retry States  
Fields: Inline error banner + detail + retry CTA.  
Examples: `Không t?i du?c d? li?u`, `K?t n?i không ?n d?nh`, CTA `Th? l?i`.

26. Loading / Skeleton States  
Fields: Skeleton for header, chips, 3 session cards, shimmer bars for title/meta/CTA, pull-to-refresh indicator.

### Session Card Variant Content Set
- Default: `Còn 1 ch?`, CTA `Vào kèo ngay`
- Near full: `S?p d?y`, CTA `Vào kèo`
- Full: `Ðã d? ngu?i`, CTA `Ðang ký d? b?`
- Confirmed booking: badge `Ðã d?t sân`
- Unconfirmed booking: badge `Chua d?t sân`
- Lower skill route: CTA `Xin vào kèo`, helper `C?n host duy?t`

## 3) Optional CSV Handoff Schema

Use this schema if exporting into spreadsheets:

- `screen_id`
- `screen_name`
- `component`
- `field`
- `sample_value`
- `state`
- `notes`
