import React from 'react'
import { useAppTheme } from '@/lib/theme-context'
import { AppFontSet } from '@/constants/typography'
import { useNotificationsContext } from '@/lib/NotificationsContext'
import { Tabs } from 'expo-router'
import { Bell, Calendar, Home, Search, User } from 'lucide-react-native'
import { Text, View } from 'react-native'
import { RADIUS, SHADOW } from '@/constants/screenLayout'

function TabIcon({
  focused,
  Icon,
  activeColor,
  inactiveColor,
}: {
  focused: boolean
  Icon: React.ComponentType<any>
  activeColor: string
  inactiveColor: string
}) {
  return (
    <View style={{ transform: [{ scale: focused ? 1.08 : 1 }] }}>
      <Icon size={28} color={focused ? activeColor : inactiveColor} strokeWidth={focused ? 2.75 : 2.25} />
    </View>
  )
}

function NotificationIcon({
  focused,
  unread,
  activeColor,
  inactiveColor,
  dangerColor,
}: {
  focused: boolean
  unread: number
  activeColor: string
  inactiveColor: string
  dangerColor: string
}) {
  const theme = useAppTheme()
  return (
    <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', transform: [{ scale: focused ? 1.08 : 1 }] }}>
      <Bell size={28} color={focused ? activeColor : inactiveColor} strokeWidth={focused ? 2.75 : 2.25} />
      {unread > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -3,
            right: -6,
            minWidth: 16,
            height: 16,
            borderRadius: RADIUS.full,
            backgroundColor: dangerColor,
            paddingHorizontal: 3,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: theme.onPrimary, fontSize: 10, fontWeight: '700' }}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : null}
    </View>
  )
}

export default function TabLayout() {
  const theme = useAppTheme()
  const { unreadCount } = useNotificationsContext()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.outline,
        tabBarStyle: {
          height: 68,
          paddingTop: 12,
          paddingBottom: 12,
          backgroundColor: theme.background,
          ...SHADOW.sm,
          borderRadius: RADIUS.xl,
          marginHorizontal: 16,
          marginBottom: 20,
          position: 'absolute',
          left: 0,
          right: 0,
          borderWidth: 0,
          borderTopWidth: 0,
          borderTopColor: 'transparent',
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontFamily: AppFontSet.label,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trang chủ',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} Icon={Home} activeColor={theme.primary} inactiveColor={theme.outline} />
          ),
        }}
      />

      <Tabs.Screen
        name="my-sessions"
        options={{
          title: 'Kèo của tôi',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} Icon={Calendar} activeColor={theme.primary} inactiveColor={theme.outline} />
          ),
        }}
      />

      <Tabs.Screen
        name="find-session"
        options={{
          title: 'Tìm kèo',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} Icon={Search} activeColor={theme.primary} inactiveColor={theme.outline} />
          ),
        }}
      />

      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Thông báo',
          tabBarIcon: ({ focused }) => (
            <NotificationIcon
              focused={focused}
              unread={unreadCount}
              activeColor={theme.primary}
              inactiveColor={theme.outline}
              dangerColor={theme.error}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Hồ sơ',
          tabBarIcon: ({ focused }) => (
            <TabIcon focused={focused} Icon={User} activeColor={theme.primary} inactiveColor={theme.outline} />
          ),
        }}
      />
    </Tabs>
  )
}
