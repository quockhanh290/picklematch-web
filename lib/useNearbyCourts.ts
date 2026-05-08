import * as Location from 'expo-location'
import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export type NearByCourt = {
  id: string
  name: string
  address: string
  city: string
  phone: string | null
  lat: number | null
  lng: number | null
  hours_open: string | null   // "HH:MM", e.g. "06:00"
  hours_close: string | null  // "HH:MM", e.g. "22:00"
  price_per_hour: number | null
  booking_url: string | null
  google_maps_url?: string | null
  hasSlots?: boolean
  distance?: number // km, present only in geo mode
}

type Result = {
  /** Geo-sorted court list or keyword-matched list */
  courts: NearByCourt[]
  /** True while the initial fetch is running */
  loading: boolean
  /** True when location is unavailable */
  fallbackMode: boolean
  /** Controlled search keyword */
  keyword: string
  setKeyword: (k: string) => void
  /** True while searching */
  searching: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeVN(str: string): string {
  if (!str) return ''
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, m => (m === 'đ' ? 'd' : 'D'))
    .toLowerCase()
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function fetchOpenCourtIds(): Promise<Set<string>> {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999)

  const { data } = await supabase
    .from('court_slots')
    .select('court_id')
    .eq('status', 'available')
    .gte('start_time', todayStart.toISOString())
    .lte('start_time', todayEnd.toISOString())

  return new Set((data ?? []).map((s: any) => s.court_id))
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useNearbyCourts(): Result {
  const [courts, setCourts]             = useState<NearByCourt[]>([])
  const [loading, setLoading]           = useState(true)
  const [fallbackMode, setFallbackMode] = useState(false)
  const [keyword, setKeyword]           = useState('')
  const [searching, setSearching]       = useState(false)

  // Master list of all courts for client-side filtering
  const allCourtsRef = useRef<NearByCourt[]>([])
  const userCoordsRef = useRef<{ lat: number; lon: number } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function init() {
      setLoading(true)

      // 1. Try to get location
      try {
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }).catch(() => null)
          
          if (loc) {
            userCoordsRef.current = { lat: loc.coords.latitude, lon: loc.coords.longitude }
          }
        }
      } catch (_) {
        setFallbackMode(true)
      }

      // 2. Load ALL courts to ensure search works for everything
      const [{ data: courtData }, openIds] = await Promise.all([
        supabase
          .from('courts')
          .select('id, name, address, city, phone, lat, lng, hours_open, hours_close, price_per_hour, booking_url, google_maps_url')
          .order('name', { ascending: true }), // Default alpha sort
        fetchOpenCourtIds(),
      ])

      if (cancelled) return

      const enriched: NearByCourt[] = (courtData ?? []).map((c: any) => ({
        ...c,
        hasSlots: openIds.has(c.id),
        distance: userCoordsRef.current && c.lat != null && c.lng != null
          ? haversineKm(userCoordsRef.current.lat, userCoordsRef.current.lon, c.lat, c.lng)
          : undefined,
      }))

      allCourtsRef.current = enriched
      
      // Initial display: If we have location, sort by distance. Otherwise just show all.
      const initialDisplay = [...enriched].sort((a, b) => {
        // Primary: has slots
        if (a.hasSlots !== b.hasSlots) return a.hasSlots ? -1 : 1
        // Secondary: distance
        if (a.distance !== undefined && b.distance !== undefined) return a.distance - b.distance
        return 0
      })

      setCourts(initialDisplay)
      setLoading(false)
    }

    init()
    return () => { cancelled = true }
  }, [])

  // ── Unified Filtering Logic ───────────────────────────────────────────────

  useEffect(() => {
    // Don't filter if we are still loading initial data
    if (loading) return

    const q = keyword.trim()
    
    // If no keyword, show the default sorted list (distance-based if available)
    if (!q) {
      const defaultSorted = [...allCourtsRef.current].sort((a, b) => {
        if (a.hasSlots !== b.hasSlots) return a.hasSlots ? -1 : 1
        if (a.distance !== undefined && b.distance !== undefined) return a.distance - b.distance
        return 0
      })
      setCourts(defaultSorted)
      setSearching(false)
      return
    }

    setSearching(true)
    const normalized = normalizeVN(q)
    
    const matched = allCourtsRef.current.filter(c =>
      normalizeVN(c.name).includes(normalized) ||
      normalizeVN(c.address).includes(normalized) ||
      normalizeVN(c.city).includes(normalized)
    )

    // When searching, still respect distance if available, but prioritize matches
    const searchSorted = matched.sort((a, b) => {
      if (a.distance !== undefined && b.distance !== undefined) return a.distance - b.distance
      return 0
    })

    setCourts(searchSorted)
    setSearching(false)
  }, [keyword, loading])

  return { courts, loading, fallbackMode, keyword, setKeyword, searching }
}
