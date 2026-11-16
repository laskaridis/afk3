import prettier from 'eslint-config-prettier';
import globals from 'globals';
import gts from 'gts';

export default [
  {ignores: ['dist/', 'node_modules/', 'coverage/']},
  ...gts,
  {files: ['eslint.config.js'], languageOptions: {sourceType: 'module'}},
  {
    files: ['vitest.config.ts'],
    languageOptions: {parserOptions: {project: false}},
    rules: {'@typescript-eslint/no-floating-promises': 'off'},
  },
  {languageOptions: {globals: globals.node}},
  prettier,
  {
    rules: {
      curly: ['error', 'all'],
      'padding-line-between-statements': [
        'error',
        {blankLine: 'always', prev: '*', next: ['if', 'for', 'while', 'do']},
        {blankLine: 'always', prev: ['if', 'for', 'while', 'do'], next: '*'},
      ],
    },
  },
];
