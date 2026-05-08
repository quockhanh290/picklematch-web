// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tsEslintPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = defineConfig([
  {
    ignores: [
      'dist/*',
      '.expo/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'web-build/**',
      'docs/**',
      'scratch/**',
      '**/*.bak',
      '**/*.tmp',
    ],
  },
  expoConfig,
  {
    plugins: {
      '@typescript-eslint': tsEslintPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'none',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          enableAutofixRemoval: {
            imports: true,
          },
        },
      ],
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'import/first': 'off',
      'no-unused-vars': 'off',
      'import/no-duplicates': 'off',
      'no-redeclare': 'off',
    },
  },
]);
