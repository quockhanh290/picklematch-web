/* global __dirname, module, require */
const createExpoWebpackConfigAsync = require('@expo/webpack-config')
const path = require('path')

module.exports = async function (env, argv) {
  const config = await createExpoWebpackConfigAsync(env, argv)

  config.resolve = config.resolve || {}
  config.resolve.alias = {
    ...(config.resolve.alias || {}),
    '@': path.resolve(__dirname),
  }

  if (env.mode === 'production') {
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        chunks: 'all',
        maxInitialRequests: 5,
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name(module) {
              const match = module.context.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/);
              const packageName = match ? match[1] : 'vendor';
              return `npm.${packageName.replace('@', '')}`;
            },
          },
        },
      },
    }
  }

  return config
}
