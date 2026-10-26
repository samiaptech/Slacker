import test from "node:test";
import assert from "node:assert/strict";
import express, { type Request } from "express";
import type { SharedRateLimiter } from "../../integrations/mongodb/index.js";
import { createErrorHandler } from "../errors.js";
import { API_RATE_LIMIT, API_RATE_WINDOW_MS, createApiRateLimitMiddleware, resolveClientIp } from "../api-rate-limit.js";
import type { Logger } from "@workspace/logging";

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const startApi = async (rateLimiter: SharedRateLimiter, resolveIp?: (request: Request) => string) => {
  const app = express();
  app.use(createApiRateLimitMiddleware({
    rateLimiter,
    trustVercelForwardedFor: false,
    ...(resolveIp ? { resolveIp } : {})
  }));
  app.use((_request, response) => response.status(200).json({ ok: true }));
  app.use(createErrorHandler({ logger }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${String(address.port)}` };
};

void test("limits 120 requests per client IP across routes and returns 429 with Retry-After", async () => {
  const eventsByKey = new Map<string, number>();
  const observedPolicies: Readonly<{ limit: number; windowMs: number }>[] = [];
  const rateLimiter: SharedRateLimiter = {
    consume: (key, limit, windowMs) => {
      observedPolicies.push({ limit, windowMs });
      const count = eventsByKey.get(key) ?? 0;
      if (count >= limit) return Promise.resolve({ allowed: false, retryAfterSeconds: 23 });
      eventsByKey.set(key, count + 1);
      return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
    }
  };
  const api = await startApi(rateLimiter, (request) => String(request.headers["x-test-client-ip"]));
  try {
    for (let index = 0; index < API_RATE_LIMIT; index += 1) {
      const path = index === 0 ? "/health" : index === 1 ? "/api/auth/callback/google" : "/missing";
      const response = await fetch(`${api.url}${path}`, {
        headers: { "x-test-client-ip": "198.51.100.10" }
      });
      assert.equal(response.status, 200);
    }
    const limited = await fetch(`${api.url}/health`, {
      headers: { "x-test-client-ip": "198.51.100.10" }
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "23");
    assert.deepEqual(await limited.json(), {
      error: {
        code: "api_rate_limited",
        message: "API request limit reached. Wait before trying again.",
        details: { retryAfterSeconds: 23 }
      }
    });
    const otherClient = await fetch(`${api.url}/missing`, {
      headers: { "x-test-client-ip": "198.51.100.11" }
    });
    assert.equal(otherClient.status, 200);
    assert.ok(observedPolicies.every(({ limit, windowMs }) =>
      limit === API_RATE_LIMIT && windowMs === API_RATE_WINDOW_MS));
  } finally {
    await new Promise<void>((resolve, reject) => {
      api.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

void test("returns a service error when shared rate-limit storage is unavailable", async () => {
  const api = await startApi({
    consume: () => Promise.reject(new Error("MongoDB unavailable"))
  });
  try {
    const response = await fetch(`${api.url}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: "rate_limit_unavailable",
        message: "Request protection is temporarily unavailable."
      }
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      api.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

void test("uses the Vercel platform client-IP header only inside the Vercel trust boundary", () => {
  const request = {
    headers: {
      "x-forwarded-for": "203.0.113.1",
      "x-vercel-forwarded-for": "198.51.100.42"
    },
    socket: { remoteAddress: "::ffff:127.0.0.1" }
  } as unknown as Request;
  assert.equal(resolveClientIp(request, true), "198.51.100.42");
  assert.equal(resolveClientIp(request, false), "127.0.0.1");
  const invalidPlatformHeader = {
    headers: { "x-vercel-forwarded-for": "198.51.100.42, 203.0.113.1" },
    socket: { remoteAddress: "192.0.2.7" }
  } as unknown as Request;
  assert.equal(resolveClientIp(invalidPlatformHeader, true), "192.0.2.7");
});
