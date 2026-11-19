'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/setup-global.js',
  setupFiles: ['<rootDir>/test/setup-env.js'],
  setupFilesAfterEnv: ['<rootDir>/test/setup-despues.js'],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.js', '<rootDir>/test/**/*.test.js'],
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 15_000,
};
