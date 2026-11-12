import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['data/', 'dist/', 'node_modules/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['server/**', 'scripts/**', '**/*.test.ts', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['client/**'],
    ignores: ['**/*.test.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-console': 'off',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Turns off the rules Prettier takes care of: keep last.
  prettier,
]);
