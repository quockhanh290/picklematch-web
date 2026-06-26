const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const tsEslintPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');

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
      'supabase/functions/**',
      '**/*.bak',
      '**/*.tmp',
    ],
  },
  expoConfig,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        __DEV__: 'readonly',
        RequestInit: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsEslintPlugin,
    },
    rules: {
      'no-undef': 'error',
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
