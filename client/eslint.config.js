import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
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
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Teaches no-unused-vars that an identifier used in JSX (<Foo/>) is used
      // — without it, every JSX-only import looks "unused". (Automatic JSX
      // runtime means jsx-uses-react / React-in-scope is unneeded.)
      'react/jsx-uses-vars': 'error',
      // Correctness: hard error — conditional/looped hooks are real bugs.
      'react-hooks/rules-of-hooks': 'error',
      // Kept active — these catch real mistakes.
      'react-hooks/exhaustive-deps': 'warn',
      // Off after per-instance review: these two react-hooks v7 additions flag
      // patterns this app uses intentionally and correctly —
      //   set-state-in-effect: timer-driven setState (App countdown) and
      //     derived-state resets on mode change in ExploreView;
      //   refs: a callback whose ASYNC body reads a ref (the parcel-enrich
      //     AbortController), which v7 mis-attributes to the render site.
      // rules-of-hooks (the rule that catches genuine bugs) stays an error.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
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
