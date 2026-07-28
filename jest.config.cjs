/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.test.ts', '!src/**/*.test.tsx'],
  moduleNameMapper: {
    '/v1/openapi\\.js$': '<rootDir>/src/api/v1/__mocks__/openapi.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@github/copilot-sdk$': '<rootDir>/src/copilot/__mocks__/copilot-sdk.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!uuid|@github/copilot-sdk|react-router|react-router-dom)/',
  ],
  transform: {
    '^.+\\.[tj]sx?$': ['@swc/jest', {
      jsc: {
        target: 'es2022',
        parser: {
          syntax: 'typescript',
          tsx: true,
          decorators: true,
        },
        transform: {
          react: {
            runtime: 'automatic',
          },
        },
      },
      module: {
        type: 'commonjs',
      },
    }],
  },
};
