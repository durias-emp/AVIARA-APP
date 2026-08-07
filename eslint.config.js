import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import noTdzReference from './eslint-rules/no-tdz-reference.js'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Local, because it is about a mistake this app keeps making rather than
    // one JavaScript in general makes. See the rule for what it catches.
    plugins: { aviara: { rules: { 'no-tdz-reference': noTdzReference } } },
    rules: {
      // An error, not a warning. Lint here carries a long baseline of warnings
      // that are read past, and this one is not a style opinion: every hit is
      // a screen that does not load.
      'aviara/no-tdz-reference': 'error',
    },
  },
  {
    // The data builders under scripts/ run in node, not the browser: they read
    // an export off disk and write a fixture. Without node globals every one
    // of them is a wall of "process is not defined" that hides real problems.
    files: ['scripts/**/*.js'],
    languageOptions: { globals: globals.node },
  },
])
