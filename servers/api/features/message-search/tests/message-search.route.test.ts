import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Logger } from "@workspace/logging";
import { createErrorHandler } from "../../../middleware/index.js";
import { createMessageSearchRoutes } from "../routes/index.js";

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const startSearchApi = async () => {
  const calls: Readonly<Record<string, unknown>>[] = [];
  const app = express();
  app.use(express.json());
  app.use(createMessageSearchRoutes({
    getIdentity: (headers) => Promise.resolve(headers["x-test-identity"] === "member"
      ? { id: "member-1", name: "Member", email: "member@example.test", image: null }
      : headers["x-test-identity"] === "outsider"
        ? { id: "outsider-1", name: "Outsider", email: "outside@example.test", image: null }
        : null),
    getWorkspaceAccess: (identity, workspaceId) => Promise.resolve(
      identity?.id === "member-1" && workspaceId === "workspace-1"
        ? { kind: "allowed" as const, access: { workspace: { id: workspaceId } } }
        : identity
          ? { kind: "denied" as const }
          : { kind: "unauthenticated" as const }
    ),
    service: {
    search: (workspaceId, userId, query, page) => {
        calls.push({ workspaceId, userId, query, page });
      return Promise.resolve({
          kind: "listed" as const,
          response: {
            query,
            page,
            results: [],
            hasMore: false,
            truncated: false
          }
        });
      }
    }
  }));
  app.use(createErrorHandler({ logger }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    calls,
    server,
    url: `http://127.0.0.1:${String(address.port)}/messages/search`
  };
};

void test("search requires authenticated workspace access and uses a private POST body", async () => {
  const api = await startSearchApi();
  try {
    const denied = await fetch(api.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Id": "workspace-1", "X-Test-Identity": "outsider" },
      body: JSON.stringify({ query: "confidential plan" })
    });
    assert.equal(denied.status, 403);
    assert.equal(api.calls.length, 0);

    const response = await fetch(api.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Id": "workspace-1", "X-Test-Identity": "member" },
      body: JSON.stringify({ query: "roadmap decision" })
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(api.url.includes("roadmap"), false);
    assert.deepEqual(api.calls[0], {
      workspaceId: "workspace-1",
      userId: "member-1",
      query: "roadmap decision",
      page: 1
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

void test("rejects malformed search bodies before calling the service", async () => {
  const api = await startSearchApi();
  try {
    const response = await fetch(api.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Id": "workspace-1", "X-Test-Identity": "member" },
      body: JSON.stringify({ query: " ", unexpected: "value" })
    });
    assert.equal(response.status, 400);
    assert.equal(api.calls.length, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      api.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
