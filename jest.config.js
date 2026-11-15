module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/e2e/'],
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@main/(.*)$': '<rootDir>/src/main/$1',
    '^@renderer/(.*)$': '<rootDir>/src/renderer/$1',
    '^@llm/(.*)$': '<rootDir>/src/llm/$1',
  },
  // Transform ES modules from @huggingface/transformers
  transformIgnorePatterns: [
    'node_modules/(?!(@huggingface/transformers)/)',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: false,
    }],
    '^.+\\.jsx?$': 'babel-jest',
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 25,
      functions: 30,
      lines: 35,
      statements: 35,
    },
    './src/shared/security/SecretGuard.ts': {
      branches: 75,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    './src/main/services/PathValidator.ts': {
      branches: 60,
      functions: 75,
      lines: 70,
      statements: 70,
    },
    './src/main/services/MarkdownLinkRepair.ts': {
      branches: 70,
      functions: 90,
      lines: 80,
      statements: 80,
    },
  },
};

