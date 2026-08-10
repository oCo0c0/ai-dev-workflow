/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
    project: ['./tsconfig.json', './tsconfig.client.json', './tsconfig.server.json'],
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // TypeScript
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-non-null-assertion': 'warn',

    // General
    'no-console': 'off',   // logger.ts wraps console, allow
    'no-debugger': 'error',
    'no-duplicate-imports': 'warn',
    'prefer-const': 'warn',
  },
  overrides: [
    {
      // Frontend files
      files: ['src/client/**/*.{ts,tsx}'],
      extends: ['plugin:react-hooks/recommended'],
      plugins: ['react-hooks'],
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
    },
    {
      // Test files
      files: ['**/*.test.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      // Bridge mjs file
      files: ['src/bridge/**/*.mjs'],
      parserOptions: { sourceType: 'module' },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '*.config.*'],
};
