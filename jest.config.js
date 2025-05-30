// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node', // Or 'jsdom' if we need browser-like environment for some tests
  roots: ['<rootDir>/src'], // Look for tests in the src directory
  testMatch: [ // Patterns to detect test files
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/?(*.)+(spec|test).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\.(ts|tsx)$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Optional: Setup files, code coverage configuration, etc.
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], // For global test setup
  // collectCoverage: true,
  // coverageDirectory: "coverage",
  // coverageReporters: ["json", "lcov", "text", "clover"],
};
