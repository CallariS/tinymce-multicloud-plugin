/** @type {import('jest').Config} */
module.exports = {
    projects: [
        {
            displayName: 'unit',
            testEnvironment: 'node',
            transform: {
                '^.+\\.tsx?$': ['ts-jest', {
                    tsconfig: 'tsconfig.test.json',
                    diagnostics: {
                        pathRegex: /^(?!.*node_modules)/,
                        warnOnly: true,
                    },
                }],
            },
            testMatch: ['<rootDir>/tests/validation/**/*.test.ts'],
            moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
            transformIgnorePatterns: [
                '[\\\\/]node_modules[\\\\/](?!(xdbc)[\\\\/])',
            ],
            setupFiles: ['<rootDir>/tests/setup.cjs'],
        },
        {
            displayName: 'providers',
            testEnvironment: 'jsdom',
            transform: {
                '^.+\\.tsx?$': ['ts-jest', {
                    tsconfig: 'tsconfig.test.json',
                    diagnostics: {
                        pathRegex: /^(?!.*node_modules)/,
                        warnOnly: true,
                    },
                }],
            },
            testMatch: ['<rootDir>/tests/providers/**/*.test.ts'],
            moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
            transformIgnorePatterns: [
                '[\\\\/]node_modules[\\\\/](?!(xdbc)[\\\\/])',
            ],
            setupFiles: ['<rootDir>/tests/setup.cjs'],
        },
    ],
};
