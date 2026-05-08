import { useEffect, useState } from 'react'

import { CourtSelectorCard } from '@/components/create-session/CourtSelectorCard'
import type { NearByCourt } from '@/lib/useNearbyCourts'
import { useNearbyCourts } from '@/lib/useNearbyCourts'
import { STRINGS } from '@/constants/strings'

type Props = {
  selectedCourt: NearByCourt | null
  onCourtSelect: (court: NearByCourt) => void
}

export function EditCourtSelector({ selectedCourt, onCourtSelect }: Props) {
  const { courts, loading, fallbackMode, keyword, setKeyword, searching } = useNearbyCourts()
  const [isChoosingCourt, setIsChoosingCourt] = useState(!selectedCourt)

  useEffect(() => {
    if (!selectedCourt) {
      setIsChoosingCourt(true)
    }
  }, [selectedCourt])

  return (
    <CourtSelectorCard
      courts={courts}
      loadingCourts={loading}
      fallbackMode={fallbackMode}
      keyword={keyword}
      setKeyword={setKeyword}
      searching={searching}
      selectedCourt={selectedCourt}
      isChoosingCourt={isChoosingCourt}
      onCourtSelect={(court) => {
        onCourtSelect(court)
        setIsChoosingCourt(false)
      }}
      onChangeCourt={() => setIsChoosingCourt((prev) => !prev)}
      title={STRINGS.create_session.step1.court_title}
    />
  )
}
