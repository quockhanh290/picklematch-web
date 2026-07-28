// Mock lucide icons for stable snapshots. Proxy fallback so any icon name
// (the library exports 1000+) resolves to a stable stub instead of `undefined`,
// which previously crashed rendering ("Element type is invalid") for icons not
// in this file's explicit allowlist (e.g. ChevronLeft in SecondaryNavbar).
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockIconInternal = () => React.createElement(View);
  const knownIcons = {
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
  return new Proxy(knownIcons, {
    get: (target: Record<string, unknown>, prop: string) => {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string' || prop === '__esModule' || prop === 'default') return undefined;
      return MockIconInternal;
    },
  });
});

// Mock linear gradient
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LinearGradient: ({ children }: any) => React.createElement(View, {}, children),
  };
});
