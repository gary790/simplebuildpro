// ============================================================
// SimpleBuild Pro — ESLint Flat Config (ESLint 10)
// Monorepo-wide linting for API (Hono/Node) + Web (Next.js/React)
// ============================================================

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // ─── Global ignores ────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/*.d.ts',
      'packages/db/drizzle/**',
    ],
  },

  // ─── Base JS rules ────────────────────────────────────────
  js.configs.recommended,

  // ─── TypeScript rules ──────────────────────────────────────
  ...tseslint.configs.recommended,

  // ─── Project-wide overrides ────────────────────────────────
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Relax rules for Phase 0 — tighten incrementally
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-case-declarations': 'warn',
      'no-useless-assignment': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'prefer-const': 'warn',
    },
  },

  // ─── API-specific rules ────────────────────────────────────
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      // API can use console.log in startup banner
      'no-console': 'off',
    },
  },

  // ─── Web (Next.js/React) specific rules ────────────────────
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: {
      // React-specific relaxations
      '@typescript-eslint/no-explicit-any': 'off', // Next.js has many any patterns
    },
  },

  // ─── Test files ────────────────────────────────────────────
  {
    files: ['tests/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // ─── CommonJS config files ─────────────────────────────────
  {
    files: ['**/*.cjs', '**/*.config.js', '**/postcss.config.js', '**/tailwind.config.js'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        exports: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },

  // ─── Prettier compat (must be last) ────────────────────────
  eslintConfigPrettier,
);
