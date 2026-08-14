module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-wind|lucide-react-native)',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^nativewind$': '<rootDir>/tests/mocks/nativewind.js',
  },
  testMatch: ['<rootDir>/tests/**/*.test.{ts,tsx}'],
  // ab-comparison alone is 15+ minutes and stress is another 10, so a plain `npm test` spent most of its
  // wall clock on two files that only matter when a change actually moves lineups. They still run, on
  // purpose, via `npm run sim:ab` / `npm run sim:stress` (jest.slow.config.js drops this exclusion).
  testPathIgnorePatterns: [
    '/node_modules/',
    '/e2e/',
    '/simulation/ab-comparison\.test\.ts$',
    '/simulation/stress\.test\.ts$',
  ],
};
