export const LIVE_VERSION_POLL_INTERVAL_MS = 4_000

export function shouldRefetchForExternalVersion(
  localVersion: number | null | undefined,
  serverVersion: number | null | undefined,
) {
  if (serverVersion === null || serverVersion === undefined) return false
  const server = Number(serverVersion)
  const local = localVersion === null || localVersion === undefined ? -1 : Number(localVersion)
  return Number.isFinite(server)
    && server > (Number.isFinite(local) ? local : -1)
}
