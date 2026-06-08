import renderer, { act } from 'react-test-renderer'
import { SessionMetaCard } from '@/components/session/SessionMetaCard'
import { SessionNavContext, type SessionNavigation } from '@/lib/navigation/SessionNavContext'

jest.mock('lucide-react-native', () => {
  const React = require('react')
  const View = (props: any) => React.createElement('View', props)
  return {
    Activity: View,
    AlertCircle: View,
    CalendarDays: View,
    CircleDollarSign: View,
    MapPin: View,
    ShieldCheck: View,
    Target: View,
    Users: View,
    Info: View,
    MessageSquareText: View,
    MessageSquare: View,
    Phone: View,
    Clock: View,
  }
})

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
}))

const mockIcon = () => {
  const React = require('react')
  return React.createElement('View')
}

const sessionNavMock: SessionNavigation = {
  onOpenSession: jest.fn(),
  onEditSession: jest.fn(),
  onViewMatchResult: jest.fn(),
  onRateSession: jest.fn(),
  onConfirmResult: jest.fn(),
  onReviewSession: jest.fn(),
  onOpenPlayerProfile: jest.fn(),
  onOpenCourt: jest.fn(),
}

describe('UI Snapshots', () => {

  test('SessionMetaCard renders correctly', () => {
    let tree: any
    act(() => {
      tree = renderer.create(
        <SessionNavContext.Provider value={sessionNavMock}>
          <SessionMetaCard
            skillLevelId="pvna_3"
            sessionSkillLabel="Intermediate"
            courtBookingStatus="confirmed"
            courtName="Court A"
            courtAddress="10 Chu Van An"
            courtCity="Da Nang"
            timeLabel="Sat, 24/05 • 08:00"
            priceLabel="50K"
            maxPlayers={4}
            hostNote="Fair play only."
          />
        </SessionNavContext.Provider>
      )
    })
    expect(tree.toJSON()).toMatchSnapshot()
  })
})
