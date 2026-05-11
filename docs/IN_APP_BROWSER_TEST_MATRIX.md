# In-App Browser Test Matrix
> [!NOTE]
> This matrix is enforced via a combination of **Automated Simulation** (Playwright) and **Physical Device Evidence** (Manual).

## Scope
- Standalone mobile browsers: iOS Safari, Android Chrome
- In-app browsers: Instagram, Facebook, LINE, WeChat
- Target: auth, routing, storage fallback, degraded network behavior

## Devices
- iPhone (latest iOS major)
- Android (latest stable major)

## Must-Pass Flows
1. Open `/host/login` directly from an external link.
2. Complete login and verify redirect out of login route.
3. Reload page and verify session restore behavior.
4. Open deep link to session detail and verify page load.
5. Navigate through notifications and verify deep-link safety.
6. Toggle airplane mode during fetch and verify user-facing recovery.

## Browser Capability Checks
1. Storage blocked/cleared:
- Verify app still loads and allows non-persistent session fallback behavior.
- Verify no blank screen or infinite loading loop.

2. Realtime degraded:
- Verify notification list still refreshes via polling fallback.
- Verify UI shows degraded connection status.

3. Viewport/keyboard:
- Focus input fields and verify no disruptive zoom on iOS.
- Verify keyboard does not permanently hide primary actions.

## Security Regression Checks
1. Confirm no service-role key in tracked files.
2. Confirm CSP header includes no `unsafe-eval`.
3. Confirm quick-start non-OTP host flow is not reachable in production builds.

## Automation Infrastructure
- **Simulation**: Run `npx playwright test --project=in-app-browser-simulation` to verify baseline resilience against blocked storage and viewport constraints.
- **Evidence Generation**: Run `node scripts/generate-release-evidence.mjs` before each release to generate the required physical device sign-off template.

## Evidence to Capture (Required for Release)
1. **Device Information**: Model, OS version, Browser/App version.
2. **Persistence Warning**: Screenshot of the "Storage blocked" banner appearing in private mode/Zalo IAB.
3. **Auth Persistence**:
   - Step 1: Login.
   - Step 2: Close App/Browser tab.
   - Step 3: Re-open link.
   - Result: Document if session persisted (Expected: Yes in Safari/Chrome, No in Private/Zalo IAB with warning).
4. **Deep-linking**:
   - Screenshot of loading a `/session/[id]` URL directly from Zalo/Messenger chat.
5. **Layout Stability**:
   - Screenshot of focused input field showing no auto-zoom on iOS.
   - Screenshot of keyboard open with "Join/Register" button still accessible or easily scrollable.

## Sign-off Log Template
| Environment | Build SHA | Tester | Status | Evidence Link |
| :--- | :--- | :--- | :--- | :--- |
| iOS Safari | | | | |
| Zalo IAB (iOS) | | | | |
| FB IAB (Android) | | | | |
| Chrome Android | | | | |
