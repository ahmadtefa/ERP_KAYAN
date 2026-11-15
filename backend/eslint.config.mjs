import js from '@eslint/js';
import typescriptParser from '@typescript-eslint/parser';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';

// TypeScript resolves undeclared names during the clean build; the plain JS
// no-undef rule cannot distinguish TS types from runtime names. The remaining
// recommended JS and TypeScript rules are not silently downgraded to warnings.
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: { '@typescript-eslint': typescriptPlugin },
    rules: {
      ...js.configs.recommended.rules,
      ...typescriptPlugin.configs.recommended.rules,
      'no-undef': 'off',
    },
  },
];
