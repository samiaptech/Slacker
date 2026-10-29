module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testMatch: ["<rootDir>/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/dist/"],
  testTimeout: 30_000,
  maxWorkers: 1,
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^node:assert/strict$": "<rootDir>/tests/jest-assert-compat.ts",
    "^node:test$": "<rootDir>/tests/jest-test-compat.ts"
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { useESM: true }]
  }
};
