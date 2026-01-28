/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.test.ts', '!src/**/*.test.tsx'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@github/copilot-sdk$': '<rootDir>/node_modules/@github/copilot-sdk/dist/index.js',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      diagnostics: { ignoreCodes: [151002] },
      tsconfig: {
        jsx: 'react-jsx',
      },
    }],
  },
};
