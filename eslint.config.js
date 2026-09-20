// Flat ESLint config. See SPEC.md §13 "ESLint guards".
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

const DATE_GUARD_MESSAGE = 'Use packages/core time.ts — see SPEC.md §7.';

const BANNED_DATE_METHODS = [
  'getFullYear',
  'getMonth',
  'getDate',
  'getDay',
  'getHours',
  'getMinutes',
  'getSeconds',
  'setFullYear',
  'setMonth',
  'setDate',
  'setDay',
  'setHours',
  'setMinutes',
  'setSeconds',
  'toLocaleDateString',
  'toLocaleTimeString',
  'getTimezoneOffset',
].join('|');

/** Bans ad-hoc date handling everywhere except the time engine itself. */
export const dateGuardRules = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length>0]",
      message: DATE_GUARD_MESSAGE,
    },
    {
      selector: "MemberExpression[object.name='Date'][property.name='parse']",
      message: DATE_GUARD_MESSAGE,
    },
    {
      selector: `CallExpression[callee.property.name=/^(${BANNED_DATE_METHODS})$/]`,
      message: DATE_GUARD_MESSAGE,
    },
  ],
};

/** Keeps the layers in SPEC.md §3 honest. */
export const layeringRules = {
  core: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@prisma/client',
            message: 'packages/core is pure TypeScript — see SPEC.md §0.6.',
          },
          { name: 'express', message: 'packages/core is pure TypeScript — see SPEC.md §0.6.' },
          { name: 'react', message: 'packages/core is pure TypeScript — see SPEC.md §0.6.' },
          { name: 'ioredis', message: 'packages/core is pure TypeScript — see SPEC.md §0.6.' },
        ],
        patterns: [
          {
            group: ['apps/*', '**/apps/*', '@beta/api', '@beta/web'],
            message: 'packages/core must not import from apps — see SPEC.md §0.6.',
          },
        ],
      },
    ],
  },
  controller: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: '@prisma/client', message: 'Controllers never touch Prisma — see SPEC.md §3.' },
        ],
        patterns: [
          {
            group: ['**/repository', '**/repository.js', '**/*.repository'],
            message: 'Controllers call services, not repositories — see SPEC.md §3.',
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      'apps/web/dev-dist/**',
      '**/dist-types/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      ...dateGuardRules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // The time engine is the one place allowed to touch raw Date APIs.
    files: ['packages/core/src/time.ts', 'apps/api/src/lib/instant.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/*.config.ts', '**/*.config.js'],
    rules: { 'no-restricted-syntax': 'off', 'no-console': 'off' },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: layeringRules.core,
  },
  {
    files: ['**/controller.ts', '**/*.controller.ts'],
    rules: layeringRules.controller,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
  },
  {
    // Developer CLIs in scripts/ report progress on stdout — that is their job.
    files: ['scripts/**/*.{js,mjs,cjs,ts}'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
