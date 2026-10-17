import js from '@eslint/js';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import a11y from 'eslint-plugin-jsx-a11y';

const browserGlobals = Object.fromEntries([
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location',
  'fetch', 'URL', 'URLSearchParams', 'FormData', 'File', 'Blob', 'Image', 'WebSocket',
  'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'console', 'alert', 'confirm', 'getComputedStyle',
  'ResizeObserver', 'AbortController', 'queueMicrotask', 'HTMLElement', 'createImageBitmap',
].map(name => [name, 'readonly']));

export default [{ ignores: ['dist/**', 'node_modules/**'] }, {
  files: ['src/**/*.{js,jsx}'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: browserGlobals },
  plugins: { react, 'react-hooks': hooks, 'jsx-a11y': a11y },
  settings: { react: { version: '18.2' } },
  rules: {
    ...js.configs.recommended.rules,
    ...Object.fromEntries(Object.entries(a11y.configs.recommended.rules).map(([rule, config]) => {
      const [level, ...options] = Array.isArray(config) ? config : [config];
      return [rule, level === 0 || level === 'off' ? 'off' : ['warn', ...options]];
    })),
    'react/jsx-uses-vars': 'error',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
    'jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['region'] }],
  },
}];
