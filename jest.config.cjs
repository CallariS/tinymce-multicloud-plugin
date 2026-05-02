/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.test.json',            diagnostics: {
                // Only report TypeScript errors from project source files, not node_modules
                pathRegex: /^(?!.*node_modules)/,
                warnOnly: true,
            },        }],
    },
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    // Allow transforming xdbc (which distributes source files under src/)
    transformIgnorePatterns: [
        '[\\\\/]node_modules[\\\\/](?!(xdbc)[\\\\/])',
    ],
    setupFiles: ['<rootDir>/tests/setup.cjs'],
};
