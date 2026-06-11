import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * Flat ESLint config for the React client.
 *  - rules-of-hooks: error (catches conditional/looped hooks)
 *  - exhaustive-deps: warn (surfaces stale-closure deps without blocking)
 *  - jsx-a11y recommended: warn (keeps the keyboard/ARIA work from regressing)
 */
export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Correctness: hard error — conditional/looped hooks are real bugs.
      'react-hooks/rules-of-hooks': 'error',
      // Advisory: surface but don't block. These flag legitimate patterns the
      // app uses deliberately (derived-state sync on mode change, etc.).
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      // Empty catch is an intentional "best effort, ignore failure" idiom here
      // (localStorage, AbortController.abort, reader.cancel).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Autofocusing the first field of a freshly-opened modal dialog is a
      // deliberate, accessible choice (focus moves into the dialog on open).
      'jsx-a11y/no-autofocus': 'off',
      // `React` must be in scope for JSX under the classic runtime; don't
      // flag it (or intentionally-unused _-prefixed names) as unused.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|React)$' }],
    },
  },
];
