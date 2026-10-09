// ESLint 9 flat config.
// Ported from the legacy .eslintrc.cjs (removed) with the repo's
// legacy-compat rule overrides preserved verbatim.
//
// NOTE on the duplicate-import guard (see design.md): ESLint rules do not
// reliably detect the cross-module same-name collision that caused the Menu
// bug (verified empirically). The reliable guard is `tsc`'s "TS2300: Duplicate
// identifier" — ensure the build's type-check (vite build / checker) runs.
import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  {
    ignores: [
      'dist',
      'node_modules',
      'electron/app',
      'electron/build',
      'capacitor.config.ts',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...eslint.configs.recommended,
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...tseslint.configs['flat/recommended'][0],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...tseslint.configs['flat/recommended'][1],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ...tseslint.configs['flat/recommended'][2],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    // Ported 1:1 from .eslintrc.cjs — legacy codebase compatibility.
    rules: {
      'react-refresh/only-export-components': [
        'off',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'no-var': 'off',
      'prefer-const': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
      'no-async-promise-executor': 'off',
      'no-unsafe-optional-chaining': 'off',
      'prefer-rest-params': 'off',
      'no-extra-boolean-cast': 'off',
      'no-control-regex': 'off',
      'no-case-declarations': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-array-constructor': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/ban-types': 'off',
      'react-hooks/rules-of-hooks': 'off',
      // v8-upgrade noise: rules stricter than the previous legacy config,
      // surfaced by the tooling upgrade on pre-existing code. Kept off to
      // preserve 1:1 behavior.
      '@typescript-eslint/no-wrapper-object-types': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-misleading-character-class': 'off',
      'no-constant-binary-expression': 'off',
      // NOTE on the duplicate-import guard (this change):
      // ESLint rules (core no-duplicate-imports, import/no-duplicates, and
      // the TS parser itself) do NOT reliably detect the cross-module
      // same-name collision that caused the Menu bug — verified empirically.
      // The reliable guard is the TypeScript compiler, which emits
      // "TS2300: Duplicate identifier 'Menu'" for that pattern. Ensure `tsc`
      // type-checks run in the build/CI path. See design.md.
      'no-duplicate-imports': 'off',
    },
  },
];