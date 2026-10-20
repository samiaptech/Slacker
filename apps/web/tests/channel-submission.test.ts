import test from "node:test";
import assert from "node:assert/strict";
import type { ChannelCreateResponse } from "@workspace/types";
import { submitChannelCreation, type CreateChannelFormValues } from "../features/channels";

const values: CreateChannelFormValues = {
  name: " General ",
  description: "  Team updates  ",
  visibility: "private"
};

const createdResponse: ChannelCreateResponse = {
  channel: {
    id: "channel-1",
    workspaceId: "workspace-1",
    name: "general",
    description: "Team updates",
    visibility: "private",
    lifecycleState: "active",
    createdBy: "user-1",
    createdAt: "2026-10-13T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    archivedAt: null
  },
  creatorMembership: {
    channelId: "channel-1",
    userId: "user-1",
    role: "admin",
    joinedAt: "2026-10-13T00:00:00.000Z"
  }
};

const dependencies = (overrides: Partial<Parameters<typeof submitChannelCreation>[0]> = {}) => ({
  apiBaseUrl: "http://localhost:4000",
  workspaceId: "workspace-1",
  values,
  getIdempotencyKey: () => "request-1",
  fetchChannel: fetch,
  onSubmittingChange: () => undefined,
  ...overrides
});

void test("returns local validation errors without starting a request", async () => {
  let fetchCount = 0;
  const busyStates: boolean[] = [];
  const result = await submitChannelCreation(dependencies({
    values: { ...values, name: "bad name" },
    fetchChannel: async () => {
      fetchCount += 1;
      return Response.json({});
    },
    onSubmittingChange: (isSubmitting) => busyStates.push(isSubmitting)
  }));

  assert.deepEqual(result, {
    kind: "invalid",
    fieldErrors: { name: "Use letters, numbers, hyphens, or underscores only." }
  });
  assert.equal(fetchCount, 0);
  assert.deepEqual(busyStates, []);
});

void test("shows loading state while submitting and returns the validated created channel", async () => {
  const busyStates: boolean[] = [];
  let resolveResponse: ((response: Response) => void) | undefined;
  const submission = submitChannelCreation(dependencies({
    fetchChannel: async (input, init) => {
      assert.equal(input.toString(), "http://localhost:4000/channels");
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "include");
      assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "request-1");
      assert.equal(new Headers(init?.headers).get("X-Workspace-Id"), "workspace-1");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        name: "General",
        description: "Team updates",
        visibility: "private"
      });
      return new Promise<Response>((resolve) => { resolveResponse = resolve; });
    },
    onSubmittingChange: (isSubmitting) => busyStates.push(isSubmitting)
  }));

  assert.deepEqual(busyStates, [true]);
  assert.ok(resolveResponse);
  resolveResponse(Response.json(createdResponse, { status: 201 }));
  assert.deepEqual(await submission, { kind: "created", response: createdResponse });
  assert.deepEqual(busyStates, [true, false]);
});

void test("maps server field errors and channel conflicts to visible form errors", async () => {
  const result = await submitChannelCreation(dependencies({
    fetchChannel: async () => Response.json({
      error: {
        code: "channel_name_conflict",
        message: "Conflict",
        details: { field: "name" }
      }
    }, { status: 409 })
  }));

  assert.deepEqual(result, {
    kind: "error",
    fieldErrors: { name: "A channel with this name already exists. Choose another name." },
    message: "A channel with this name already exists. Choose another name."
  });
});

void test("returns a visible request error and always clears the loading state", async () => {
  const busyStates: boolean[] = [];
  const result = await submitChannelCreation(dependencies({
    fetchChannel: () => Promise.reject(new Error("network unavailable")),
    onSubmittingChange: (isSubmitting) => busyStates.push(isSubmitting)
  }));

  assert.deepEqual(result, {
    kind: "error",
    fieldErrors: {},
    message: "The channel could not be created. Check your connection and try again."
  });
  assert.deepEqual(busyStates, [true, false]);
});
