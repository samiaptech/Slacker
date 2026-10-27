import test from "node:test";
import assert from "node:assert/strict";
import { createWebContentSecurityPolicy } from "../config/security-policy";

void test("creates a nonce-based production policy for API and realtime connections", () => {
  const policy = createWebContentSecurityPolicy({
    apiBaseUrl: "https://api.example.test/v1",
    nonce: "request-nonce",
    production: true
  });

  assert.match(policy, /script-src 'self' 'nonce-request-nonce' 'strict-dynamic'/);
  assert.match(policy, /connect-src 'self' https:\/\/api\.example\.test wss:\/\/api\.example\.test/);
  assert.match(policy, /img-src 'self' data: blob: https:\/\/\*\.googleusercontent\.com/);
  assert.match(policy, /style-src-attr 'unsafe-inline'/);
  assert.doesNotMatch(policy, /style-src-elem[^;]*unsafe-inline/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.doesNotMatch(policy, /unsafe-eval|script-src[^;]*unsafe-inline/);
});

void test("allows Next.js development eval without enabling it in production", () => {
  const policy = createWebContentSecurityPolicy({
    apiBaseUrl: "http://localhost:4000",
    nonce: "development-nonce",
    production: false
  });

  assert.match(policy, /script-src 'self' 'nonce-development-nonce' 'strict-dynamic' 'unsafe-eval'/);
  assert.match(policy, /connect-src 'self' http:\/\/localhost:4000 ws:\/\/localhost:4000/);
  assert.match(policy, /style-src-elem 'self' 'unsafe-inline'/);
  assert.doesNotMatch(policy, /style-src-elem[^;]*nonce-/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});
