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
      // Dropping a field by naming it and spreading the rest is how this app
      // removes one, and the clearest way to write it: `const { deletedAt,
      // ...restored } = row` is the whole of undeleting an aircraft. The name
      // is deliberately unused, which is the point of it, so it is not a
      // finding. Everything else no-unused-vars catches still counts.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    // The data builders under scripts/ run in node, not the browser: they read
    // an export off disk and write a fixture. Without node globals every one
    // of them is a wall of "process is not defined" that hides real problems.
    //
    // Same for the two other places this repo runs server-side rather than in
    // a browser: api/ is the Vercel serverless functions, and services/ is the
    // standalone aviara-svc. Both read process.env and one of them builds a
    // Buffer, and every one of those was being reported as an undefined
    // variable, which is fifteen findings that were never bugs sitting on top
    // of the ones that are.
    files: ['scripts/**/*.js', 'api/**/*.js', 'services/**/*.js'],
    languageOptions: { globals: globals.node },
  },
])
