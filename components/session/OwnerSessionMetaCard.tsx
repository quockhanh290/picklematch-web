import { useAppTheme } from '@/lib/theme-context'
import { SCREEN_FONTS } from '@/constants/typography'
import { getSkillLevelUi } from '@/lib/skillLevelUi'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import {  MapPin, Building2 } from 'lucide-react-native'
import { RADIUS, SHADOW, BORDER } from '@/constants/screenLayout'
import type { EloLevelId } from '@/lib/eloSystem'
import type { Court } from '@/lib/home/types'

type Props = {
  skillLevelId: EloLevelId
  sessionSkillLabel: string
  courtName: string
  courtAddress: string
  courtCity: string
  timeLabel: string
  priceLabel: string
  isRanked?: boolean | null
  subCourts: number[]
  maxPlayers: number
  court?: Court | null
  requireResults?: boolean
}

export function OwnerSessionMetaCard({
  skillLevelId,
  sessionSkillLabel,
  courtName,
  courtAddress,
  courtCity,
  timeLabel,
  priceLabel,
  isRanked,
  subCourts,
  maxPlayers,
  court,
  requireResults
}: Props) {
  const theme = useAppTheme()
  const { t } = useTranslation()
  const _levelUi = getSkillLevelUi(skillLevelId)
  
  const [datePart, clockPart] = timeLabel.split('•').map((s) => s.trim())

  return (
    <View
      style={{
        borderRadius: RADIUS.lg,
        overflow: 'hidden',
        backgroundColor: theme.surfaceContainerLowest,
        borderWidth: BORDER.base,
        borderColor: theme.primary,
        ...SHADOW.sm,
      }}
    >
      <View
        style={{
          backgroundColor: theme.primary,
          paddingHorizontal: 16,
          paddingVertical: 8,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Building2 size={14} color={theme.onPrimary} />
          <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.headline, fontSize: 11, letterSpacing: 1 }}>
            {t('owner_meta_card.pro_match')}
          </Text>
        </View>
        <Text style={{ color: theme.onPrimary, fontFamily: SCREEN_FONTS.label, fontSize: 11, opacity: 0.8 }}>
          {isRanked ? t('owner_meta_card.ranked') : t('owner_meta_card.unranked')}
        </Text>
      </View>

      <View style={{ padding: 16 }}>
        <Text style={{ 
          color: theme.onSurface, 
          fontFamily: SCREEN_FONTS.headline, 
          fontSize: 28, 
          textTransform: 'uppercase',
          marginBottom: 4
        }}>
          {courtName}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MapPin size={12} color={theme.onSurfaceVariant} />
          <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 13 }}>
            {courtAddress}, {courtCity}
          </Text>
        </View>

        <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginVertical: 16 }} />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: theme.outline, fontFamily: SCREEN_FONTS.label, fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>
              {t('owner_meta_card.time_label')}
            </Text>
            <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 24 }}>
              {clockPart || timeLabel}
            </Text>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 12 }}>
              {datePart}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: theme.outline, fontFamily: SCREEN_FONTS.label, fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>
              {t('owner_meta_card.cost_label')}
            </Text>
            <Text style={{ color: theme.primary, fontFamily: SCREEN_FONTS.headline, fontSize: 24 }}>
              {priceLabel}
            </Text>
            <Text style={{ color: theme.onSurfaceVariant, fontFamily: SCREEN_FONTS.body, fontSize: 11 }}>
              {t('owner_meta_card.per_person')}
            </Text>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginVertical: 16 }} />

        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <View style={{ backgroundColor: theme.surface, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: theme.outlineVariant }}>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.label, fontSize: 12 }}>
                {sessionSkillLabel}
              </Text>
            </View>
            
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {subCourts.map(num => (
                <View key={num} style={{ 
                  backgroundColor: theme.primary, 
                  borderRadius: 4, 
                  paddingHorizontal: 8, 
                  paddingVertical: 2,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4
                }}>
                  <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.onPrimary }} />
                  <Text style={{ 
                    fontFamily: SCREEN_FONTS.cta, 
                    color: theme.onPrimary, 
                    fontSize: 10,
                    textTransform: 'uppercase'
                  }}>
                    {t('owner_meta_card.court_num', { num })}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 16 }}>
            <View style={{ flex: 1, backgroundColor: theme.surfaceContainerLow, padding: 12, borderRadius: RADIUS.md }}>
              <Text style={{ color: theme.outline, fontFamily: SCREEN_FONTS.label, fontSize: 9, textTransform: 'uppercase', marginBottom: 2 }}>{t('owner_meta_card.result_label')}</Text>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 14 }}>
                {requireResults ? t('owner_meta_card.result_required') : t('owner_meta_card.result_optional')}
              </Text>
            </View>
            <View style={{ flex: 1, backgroundColor: theme.surfaceContainerLow, padding: 12, borderRadius: RADIUS.md }}>
              <Text style={{ color: theme.outline, fontFamily: SCREEN_FONTS.label, fontSize: 9, textTransform: 'uppercase', marginBottom: 2 }}>{t('owner_meta_card.scale_label')}</Text>
              <Text style={{ color: theme.onSurface, fontFamily: SCREEN_FONTS.headline, fontSize: 14 }}>
                {t('owner_meta_card.player_count', { count: maxPlayers })}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
