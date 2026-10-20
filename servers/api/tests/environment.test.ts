import test from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import { createApiConfig, readApiEnvironment } from "../config/index.js";

void test("derives API configuration from validated environment input", () => {
  const source = {
    NODE_ENV: "production",
    API_HOST: "0.0.0.0",
    API_PORT: "8080",
    WEB_ORIGIN: "https://example.test",
    MONGODB_URI: "mongodb://localhost:27017/workspace",
    BETTER_AUTH_URL: "https://api.example.test",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
    GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "client-secret",
    LOG_LEVEL: "warn"
  };
  const environment = readApiEnvironment(source);
  assert.deepEqual(createApiConfig(environment), {
    environment: "production",
    host: "0.0.0.0",
    port: 8080,
    webOrigin: "https://example.test",
    mongodbUri: "mongodb://localhost:27017/workspace",
    betterAuthUrl: "https://api.example.test",
    betterAuthSecret: "test-secret-that-is-at-least-thirty-two-characters",
    googleClientId: "client-id.apps.googleusercontent.com",
    googleClientSecret: "client-secret",
    logLevel: "warn"
  });
});

void test("rejects invalid server environment input", () => {
  assert.throws(() => readApiEnvironment({ API_PORT: "70000" }));
  assert.throws(() => readApiEnvironment({
    NODE_ENV: "test",
    API_HOST: "127.0.0.1",
    API_PORT: "4000",
    WEB_ORIGIN: "http://localhost:3000",
    MONGODB_URI: "mongodb://localhost/workspace",
    BETTER_AUTH_URL: "http://localhost:4000",
    BETTER_AUTH_SECRET: "short",
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret",
    LOG_LEVEL: "silent"
  }));
});

void test("requires runtime values from the environment", () => {
  assert.throws(() => readApiEnvironment({}), ZodError);
});
