module.exports = function (api) {
  api.cache(true)
  const isTest = process.env.NODE_ENV === 'test'

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', {
        alias: {
          '@': '.',
        },
      }],
      'expo-router/babel',
      'react-native-reanimated/plugin',
      ...(!isTest ? ['nativewind/babel'] : []),
    ],
  }
}
