/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.json',
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'import', 'sonarjs'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:sonarjs/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  rules: {
    // Complejidad — mismos umbrales que el monorepo
    'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
    'max-depth': ['error', 3],
    'complexity': ['warn', 15],
    'sonarjs/cognitive-complexity': ['warn', 20],

    // Codigo limpio
    'no-console': 'warn',
    'no-debugger': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],

    // TypeScript
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/naming-convention': [
      'warn',
      { selector: 'interface', format: ['PascalCase'] },
      { selector: 'typeAlias', format: ['PascalCase'] },
      { selector: 'enum', format: ['PascalCase'] },
      { selector: 'enumMember', format: ['UPPER_CASE', 'PascalCase'] },
    ],

    // Imports
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    'import/no-duplicates': 'error',

    // SonarJS - Codigo duplicado y code smells
    'sonarjs/no-duplicate-string': ['warn', { threshold: 3 }],
    'sonarjs/no-identical-functions': 'warn',
    'sonarjs/no-collapsible-if': 'warn',
  },
  overrides: [
    // Tests — relajar reglas de complejidad y any
    {
      files: ['*.spec.ts', '*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        'max-lines-per-function': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        'sonarjs/no-duplicate-string': 'off',
      },
    },
    // Archivos JS/CJS de configuración
    {
      files: ['*.cjs', '*.mjs', '*.js'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
    // Componentes React (.tsx) — permiten funciones más largas por JSX verboso
    {
      files: ['**/*.tsx'],
      rules: {
        'max-lines-per-function': ['warn', { max: 100, skipBlankLines: true, skipComments: true }],
      },
    },
    // Vistas de plugin — usan getHostUI() cuyos tipos dependen de @coongro/ui-components
    // que no esta disponible en el tsconfig del plugin (se carga en runtime desde el host).
    // Los tipos del SDK retornan 'error' type, causando falsos positivos en no-unsafe-*.
    {
      files: ['src/views/**/*.tsx', 'src/components/**/*.tsx', 'src/contributions/**/*.tsx'],
      rules: {
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'coverage/',
    '*.min.js',
    '*.d.ts',
  ],
};
