/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: ['src/**/*.ts', 'src/**/*.tsx', '!src/**/*.test.ts', '!src/**/*.test.tsx'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@github/copilot-sdk$': '<rootDir>/node_modules/@github/copilot-sdk/dist/index.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!uuid|@github/copilot-sdk|react-router|react-router-dom)/',
  ],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', {
      diagnostics: { ignoreCodes: [151002, 2307] },
      tsconfig: {
        jsx: 'react-jsx',
        allowJs: true,
      },
    }],
  },
};
