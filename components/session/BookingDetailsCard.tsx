import { useAppTheme } from '@/lib/theme-context'
import { FileText, Hash, Phone, ShieldAlert, ShieldCheck, User } from 'lucide-react-native'
import type { ComponentType } from 'react'
import { Text, View } from 'react-native'
import { SCREEN_FONTS } from '@/constants/typography'
import { RADIUS, SPACING } from '@/constants/screenLayout'
import { STRINGS } from '@/constants/strings'

type Props = {
  courtBookingStatus: 'confirmed' | 'unconfirmed'
  bookingReference?: string | null
  bookingName?: string | null
  bookingPhone?: string | null
  bookingNotes?: string | null
}

function InfoRow({
  icon: Icon,
  label,
  value,
  showDivider = true,
  theme,
}: {
  icon: ComponentType<any>
  label: string
  value: string
  showDivider?: boolean
  theme: any
}) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: RADIUS.full,
            backgroundColor: theme.surfaceContainerLow,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={18} color={theme.primary} strokeWidth={2.4} />
        </View>
        <View style={{ marginLeft: 14, flex: 1 }}>
          <Text
            style={{
              fontSize: 10,
              fontFamily: SCREEN_FONTS.headline,
              textTransform: 'uppercase',
              letterSpacing: 1.8,
              color: theme.outline,
            }}
          >
            {label}
          </Text>
          <Text
            style={{
              marginTop: 3,
              fontSize: 14,
              fontFamily: SCREEN_FONTS.label,
              color: theme.onSurface,
              lineHeight: 20,
            }}
          >
            {value}
          </Text>
        </View>
      </View>
      {showDivider && (
        <View style={{ height: 1, backgroundColor: theme.outlineVariant, marginVertical: 14 }} />
      )}
    </>
  )
}

export function BookingDetailsCard({
  courtBookingStatus,
  bookingReference,
  bookingName,
  bookingPhone,
  bookingNotes,
}: Props) {
  const theme = useAppTheme()
  const isConfirmed = courtBookingStatus === 'confirmed'
  const rows = (
    [
      bookingReference ? { icon: Hash, label: STRINGS.common.booking_ref, value: bookingReference } : null,
      bookingName ? { icon: User, label: STRINGS.common.booking_name, value: bookingName } : null,
      bookingPhone ? { icon: Phone, label: STRINGS.common.phone_number, value: bookingPhone } : null,
      bookingNotes ? { icon: FileText, label: STRINGS.session_detail.meta.notes, value: bookingNotes } : null,
    ] as ({ icon: ComponentType<any>; label: string; value: string } | null)[]
  ).filter((r): r is { icon: ComponentType<any>; label: string; value: string } => r !== null)

  if (rows.length === 0) return null

  return (
    <View
      style={{
        marginTop: 16,
        borderRadius: RADIUS.hero,
        backgroundColor: theme.surfaceContainerLowest,
        shadowColor: theme.onBackground,
        shadowOpacity: 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 3,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: SPACING.xl,
          paddingTop: 18,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.outlineVariant,
        }}
      >
        <View>
          <Text
            style={{
              fontSize: 10,
              fontFamily: SCREEN_FONTS.headline,
              textTransform: 'uppercase',
              letterSpacing: 1.8,
              color: theme.outline,
            }}
          >
            {STRINGS.common.booking_info}
          </Text>
          <Text
            style={{
              marginTop: 3,
              fontSize: 13,
              fontFamily: SCREEN_FONTS.label,
              color: theme.onSurfaceVariant,
            }}
          >
            {STRINGS.common.host_only_visibility}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: RADIUS.full,
            paddingHorizontal: 12,
            paddingVertical: 7,
            backgroundColor: isConfirmed
              ? theme.secondaryContainer
              : theme.surfaceContainerHighest,
          }}
        >
          {isConfirmed
            ? <ShieldCheck size={13} color={theme.surfaceTint} strokeWidth={2.5} />
            : <ShieldAlert size={13} color={theme.outline} strokeWidth={2.5} />}
          <Text
            style={{
              marginLeft: 6,
              fontSize: 12,
              fontFamily: SCREEN_FONTS.headline,
              color: isConfirmed ? theme.surfaceTint : theme.outline,
            }}
          >
            {isConfirmed ? STRINGS.session.booking.confirmed : STRINGS.session.booking.unconfirmed}
          </Text>
        </View>
      </View>

      {/* Info rows */}
      <View style={{ paddingHorizontal: SPACING.xl, paddingTop: 18, paddingBottom: 20 }}>
        {rows.map((row, index) => (
          <InfoRow
            key={row.label}
            icon={row.icon}
            label={row.label}
            value={row.value}
            showDivider={index < rows.length - 1}
            theme={theme}
          />
        ))}
      </View>
    </View>
  )
}




