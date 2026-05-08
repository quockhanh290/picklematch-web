// Mock lucide icons for stable snapshots
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockIconInternal = () => React.createElement(View);
  return {
    Activity: MockIconInternal,
    AlertCircle: MockIconInternal,
    CalendarDays: MockIconInternal,
    CircleDollarSign: MockIconInternal,
    MapPin: MockIconInternal,
    ShieldCheck: MockIconInternal,
    Target: MockIconInternal,
    Users: MockIconInternal,
    MessageSquareText: MockIconInternal,
  };
});

// Mock linear gradient
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children }: any) => React.createElement(View, {}, children),
  };
});
