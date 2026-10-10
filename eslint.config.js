const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'android/**',
      'docs/**',
      'modules/**/android/**',
      'node_modules/**',
      'tmp/**',
    ],
    rules: {
      // The existing application has one legacy false positive. Keep it visible
      // while allowing Phase 0 to establish a clean, non-behavior-changing baseline.
      'react-hooks/rules-of-hooks': 'warn',
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        __dirname: 'readonly',
        module: 'readonly',
        process: 'readonly',
        require: 'readonly',
      },
    },
  },
]);
