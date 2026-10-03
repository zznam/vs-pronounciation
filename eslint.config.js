const js = require('@eslint/js');

module.exports = [
    { ignores: ['coverage/**', '.vscode-test/**'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { AbortController: 'readonly', URL: 'readonly', process: 'readonly', Buffer: 'readonly', setImmediate: 'readonly', __dirname: 'readonly' }
        },
        rules: { eqeqeq: 'error', 'no-var': 'error', 'prefer-const': 'error' }
    }
];
