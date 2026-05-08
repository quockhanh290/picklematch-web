import { COURT_FALLBACK_IMAGES } from './formatters'
import type { FamiliarCourt, HomeSessionRecord } from './types'

type FavoriteCourtMeta = {
  id: string
  name?: string | null
  address?: string | null
  city?: string | null
}

/**
 * Robust image resolver that prioritizes real photos over streetview placeholders.
 * Returns a fallback image if no valid photo is found.
 */
export function resolveCourtImage(sessionImage: string | null | undefined, imagesRaw: any, thumbnailUrl: string | null | undefined): string {
  // 1. If we have a specific session image provided (e.g. from a past match report), use it
  if (sessionImage && !sessionImage.includes('streetviewpixels')) {
    return sessionImage
  }

  // 2. Normalize images array from metadata
  const images = Array.isArray(imagesRaw) ? imagesRaw : (typeof imagesRaw === 'string' ? [imagesRaw] : [])

  // 3. Look for a "Real" photo (not from Google Streetview)
  const realPhoto = images.find((img: any) => {
    const url = typeof img === 'string' ? img : img?.image
    return url && typeof url === 'string' && !url.includes('streetviewpixels')
  })

  if (realPhoto) {
    return typeof realPhoto === 'string' ? realPhoto : realPhoto.image
  }

  // 4. Fallback to session image if it was streetview (better than generic fallback)
  if (sessionImage) return sessionImage

  // 5. Fallback to thumbnail from metadata
  if (thumbnailUrl) return thumbnailUrl

  // 6. Last resort: Return a stable fallback based on some property to keep it consistent
  // Using a hash-like approach for consistency if we had an ID, but here we'll just use the first fallback
  return COURT_FALLBACK_IMAGES[0]
}

export function buildLiveFamiliarCourts(
  sessions: HomeSessionRecord[],
  options?: {
    favoriteCourtIds?: string[] | null
    favoriteCourtsMeta?: FavoriteCourtMeta[]
    courtsRaw?: any[]
  },
): FamiliarCourt[] {
  const grouped = new Map<string, {
    id: string;
    name: string;
    area: string;
    openMatches: number;
    thumbnail_url?: string | null;
    rating?: number | null;
    rating_count?: number | null;
    image?: string | null;
  }>()

  sessions.forEach((session) => {
    const court = session.slot?.court
    if (!court) return

    // Ensure session is actually open and has slots left
    const _confirmedCount = (session.session_players ?? []).filter(sp => sp.status === 'confirmed').length
    // Host is always included, so active players = confirmed players (excluding host if they are already in confirmed) + 1 if host not in confirmed
    const participantIds = new Set(session.session_players.filter(sp => sp.status === 'confirmed').map(p => p.player_id))
    const activePlayers = participantIds.has(session.host_id) ? participantIds.size : participantIds.size + 1
    const slotsLeft = Math.max(session.max_players - activePlayers, 0)

    const startTime = session.slot?.start_time
    const isStarted = startTime ? Date.parse(startTime) < Date.now() : false

    if (session.status !== 'open' || slotsLeft <= 0 || isStarted) return

    const current = grouped.get(court.id)
    if (current) {
      current.openMatches += 1
      return
    }

    const image = resolveCourtImage(null, court.images, court.thumbnail_url)

    grouped.set(court.id, {
      id: court.id,
      name: court.name,
      area: court.address || court.city,
      openMatches: 1,
      thumbnail_url: court.thumbnail_url,
      rating: court.rating,
      rating_count: court.rating_count,
      image: image,
    })
  })

  const buildCourtNote = (openMatches: number) =>
    openMatches >= 4
      ? 'Nhiều kèo đang mở, dễ vào sân nhanh'
      : openMatches >= 2
        ? 'Có kèo đều trong ngày, hợp để canh ghép trình'
        : openMatches >= 1
          ? 'Đang có tín hiệu mở kèo, đáng để theo dõi'
          : 'Tạm chưa có kèo mở, hệ thống sẽ cập nhật sớm'

  const favoriteCourtIds = options?.favoriteCourtIds?.filter(Boolean) ?? []
  const favoriteCourtsMeta = options?.favoriteCourtsMeta ?? []

  const courtsRaw = options?.courtsRaw ?? []

  // Merge grouped courts (active matches) with raw courts from DB
  courtsRaw.forEach(court => {
    if (!grouped.has(court.id)) {
      const image = resolveCourtImage(null, court.images, court.thumbnail_url)

      grouped.set(court.id, {
        id: court.id,
        name: court.name,
        area: court.address || court.city,
        openMatches: 0,
        thumbnail_url: court.thumbnail_url,
        rating: court.rating,
        rating_count: court.rating_count,
        image: image
      })
    }
  })

  if (favoriteCourtIds.length > 0) {
    const favoriteMetaMap = new Map(favoriteCourtsMeta.map((court) => [court.id, court]))

    return favoriteCourtIds.map((courtId, index) => {
      const groupedCourt = grouped.get(courtId)
      const favoriteMeta = favoriteMetaMap.get(courtId)
      const openMatches = groupedCourt?.openMatches ?? 0
      const fallbackArea = [favoriteMeta?.address, favoriteMeta?.city].filter(Boolean).join(', ')
      const resolvedArea = groupedCourt?.area ?? fallbackArea

      const resolvedImage = groupedCourt?.image || resolveCourtImage(null, favoriteMeta?.images, favoriteMeta?.thumbnail_url)

      return {
        id: courtId,
        name: groupedCourt?.name ?? favoriteMeta?.name ?? 'Sân quen',
        area: resolvedArea || 'Chưa rõ khu vực',
        openMatches,
        note: buildCourtNote(openMatches),
        image: resolvedImage || COURT_FALLBACK_IMAGES[index % COURT_FALLBACK_IMAGES.length],
        thumbnail_url: groupedCourt?.thumbnail_url || favoriteMeta?.thumbnail_url,
        rating: groupedCourt?.rating,
        rating_count: groupedCourt?.rating_count,
      }
    })
  }

  return Array.from(grouped.values())
    .sort((left, right) => right.openMatches - left.openMatches)
    .slice(0, 15)
    .map((court, index) => ({
      id: court.id,
      name: court.name,
      area: court.area,
      openMatches: court.openMatches,
      note: buildCourtNote(court.openMatches),
      image: court.image || COURT_FALLBACK_IMAGES[index % COURT_FALLBACK_IMAGES.length],
      thumbnail_url: court.thumbnail_url,
      rating: court.rating,
      rating_count: court.rating_count,
    }))
}
