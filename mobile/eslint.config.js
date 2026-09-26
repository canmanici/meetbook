// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Test files: jest.mock factories must use require() and must be declared
    // before imports (jest hoists them); mock components are anonymous arrows.
    // These rules only create noise in tests, so they are off for test files.
    files: ['**/__tests__/**/*.{js,jsx,ts,tsx}', '**/*.test.{js,jsx,ts,tsx}'],
    rules: {
      'react/display-name': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'import/first': 'off',
    },
  },
]);
