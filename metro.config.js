const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@': path.resolve(__dirname),
};
config.resolver.sourceExts = Array.from(
  new Set([...(config.resolver.sourceExts || []), 'mjs', 'cjs'])
);
config.resolver.resolverMainFields = ['react-native', 'browser', 'module', 'main'];

module.exports = config;
