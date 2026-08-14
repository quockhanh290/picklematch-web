// The long simulations, which the default run skips. Same config, minus the exclusion.
// Run them on purpose: `npm run sim:ab`, `npm run sim:stress`.
const base = require('./jest.config')

module.exports = {
  ...base,
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
}
