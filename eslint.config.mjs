// Lint for the source, the tests, and the scripts.
//
// The rules of docs/implementation/19-refactor.md §2.5 (return early, keep
// functions small) and §3 (doc blocks) are errors everywhere. Code written
// before they arrived is let through by eslint.known-violations.mjs, which
// turns a rule off for each file that broke it then and names the functions
// still over a size limit. Each phase that fixes a file takes it off the list,
// so the lists only shrink; `npm run lint:baseline` rewrites the file from
// what the code does now, and its diff is the record of what changed.
import jsdoc from 'eslint-plugin-jsdoc';
import unicorn from 'eslint-plugin-unicorn';
import typescriptEslint from 'typescript-eslint';

import knownViolations from './eslint.known-violations.mjs';

/** Setting DECKARD_LINT_ALL=1 lints without the known violations, to list them. */
const lintAll = process.env.DECKARD_LINT_ALL === '1';

/** The shape rules of §2.5, the same for TypeScript and JavaScript. */
const shapeRules = {
  curly: 'warn',
  eqeqeq: 'warn',
  'no-throw-literal': 'warn',
  semi: 'warn',
  'no-else-return': ['error', { allowElseIf: false }],
  'no-lonely-if': 'error',
  'max-depth': ['error', 3],
  'no-nested-ternary': 'error',
  'no-case-declarations': 'error',
  complexity: ['error', { max: 15, variant: 'modified' }],
  'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
  'unicorn/prefer-early-return': 'error',
  'unicorn/no-negated-condition': 'error',
};

/** The doc-block rules of §3 that apply whatever the language. */
const docRules = {
  'jsdoc/require-jsdoc': ['error', {
    publicOnly: { ancestorsOnly: true },
    require: {
      ClassDeclaration: true,
      MethodDefinition: true,
      FunctionDeclaration: true,
      ArrowFunctionExpression: true,
    },
    contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'],
  }],
  'jsdoc/check-param-names': 'error',
  // A block with no @param at all is fine, since the name and type usually
  // say it; a block that documents some parameters documents them all.
  'jsdoc/require-param': ['error', { ignoreWhenAllParamsMissing: true }],
  'jsdoc/no-undefined-types': 'error',
  'jsdoc/no-blank-blocks': 'error',
  'jsdoc/informative-docs': 'error',
};

/** eslint-plugin-jsdoc's TSDoc set, which TypeDoc reads, raised to errors. */
const tsdoc = jsdoc.configs['flat/recommended-tsdoc'];
const isOn = (setting) => (Array.isArray(setting) ? setting[0] : setting) !== 'off';
const tsdocRules = Object.fromEntries(
  Object.entries(tsdoc.rules)
    .filter(([, setting]) => isOn(setting))
    .map(([rule, setting]) => [rule, Array.isArray(setting) ? ['error', ...setting.slice(1)] : 'error']),
);

export default [
  {
    ignores: [
      'out/**', 'dist/**', 'node_modules/**', '.vscode-test/**', '.vscode/**',
      'docs/**', 'resources/**', 'development/**', 'syntaxes/**', 'test/ui/visual-baseline/**',
      '*.vsix',
    ],
  },
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': typescriptEslint.plugin,
      jsdoc,
      unicorn,
    },
    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      // Type information, which switch-exhaustiveness-check needs.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...tsdocRules,
      // §3: @returns only when the name and type do not already say it.
      'jsdoc/require-returns': 'off',
      ...docRules,
      ...shapeRules,
      '@typescript-eslint/naming-convention': ['warn', {
        selector: 'import',
        format: ['camelCase', 'PascalCase'],
      }],
      // The core rule counts an explicit `this` as a parameter; this one does not.
      'max-params': 'off',
      '@typescript-eslint/max-params': ['error', { max: 4 }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    plugins: { jsdoc, unicorn },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
    },
    rules: {
      ...docRules,
      ...shapeRules,
      'max-params': ['error', 4],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // A native title never shows on keyboard focus, so a control says what
    // it does with data-tip (docs/implementation/20-webviews.md §2.4). The
    // test of drawn pages sees only the states a surface draws; this sees
    // every element a page's TSX can write. There is no .tsx file before
    // Phase 6 moves the first page.
    files: ['src/**/*.tsx'],
    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "JSXOpeningElement[name.name=/^(button|summary|input|select|textarea|a)$/] > JSXAttribute[name.name='title']",
          message: 'A control says what it does with data-tip, which shows on keyboard focus; a native title does not.',
        },
        {
          selector: "JSXOpeningElement:has(JSXAttribute[name.name=/^tab[iI]ndex$/]) > JSXAttribute[name.name='title']",
          message: 'A focusable element says what it does with data-tip, which shows on keyboard focus; a native title does not.',
        },
      ],
    },
  },
  {
    // A mocha suite is one callback that holds every test in it, so its
    // length is the suite's, not a function's.
    files: ['src/test/**/*.test.ts', 'test/e2e/*.e2e.js'],
    rules: { 'max-lines-per-function': 'off' },
  },
  ...(lintAll ? [] : Object.entries(knownViolations).map(([rule, files]) => ({
    files: Object.keys(files),
    rules: { [rule]: 'off' },
  }))),
];
