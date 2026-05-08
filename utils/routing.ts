/**
 * Validates a deep link path against the app's allowed routes.
 * This prevents potential open redirect vulnerabilities from notification payloads.
 */
export function validateDeepLink(path: string | null | undefined): string | null {
  if (!path) return null

  // Allowlist of valid route patterns
  const allowedPatterns = [
    /^\/\(tabs\)$/,
    /^\/login$/,
    /^\/onboarding$/,
    /^\/profile-setup$/,
    /^\/create-session$/,
    /^\/edit-profile$/,
    /^\/profile-preview$/,
    /^\/host-review\/[^/]+$/,
    /^\/match-result\/[^/]+$/,
    /^\/player\/[^/]+$/,
    /^\/rate-session\/[^/]+$/,
    /^\/session\/[^/]+$/,
    /^\/session\/[^/]+\/confirm-result$/,
    /^\/session\/[^/]+\/review$/,
  ]

  // Check if the path matches any allowed pattern
  const isValid = allowedPatterns.some((pattern) => pattern.test(path))

  if (isValid) {
    return path
  }

  console.warn(`[Routing] Blocked unauthorized deep link: ${path}`)
  return null
}
