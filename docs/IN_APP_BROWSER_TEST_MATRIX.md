# In-App Browser Test Matrix

## Scope
- Standalone mobile browsers: iOS Safari, Android Chrome
- In-app browsers: Instagram, Facebook, LINE, WeChat
- Target: auth, routing, storage fallback, degraded network behavior

## Devices
- iPhone (latest iOS major)
- Android (latest stable major)

## Must-Pass Flows
1. Open `/owner/login` directly from an external link.
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
3. Confirm quick-start non-OTP owner flow is not reachable in production builds.

## Evidence to Capture
- Screen recording per environment.
- Console/network errors.
- Final pass/fail checklist with build SHA.
