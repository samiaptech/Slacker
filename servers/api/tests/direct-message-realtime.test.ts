import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { io as createClient, type Socket } from "socket.io-client";
import type { Logger } from "@workspace/logging";
import type {
  DirectMessageResponse,
  RealtimeClientEvents,
  RealtimeServerEvents
} from "@workspace/types";
import {
  createWorkspaceChannelRealtime,
  type WorkspaceChannelService
} from "../features/channels/index.js";
import {
  createDirectMessageRealtime,
  type DirectConversationWithParticipant,
  type DirectMessageService
} from "../features/direct-messages/index.js";
import { createSocketIoIntegration } from "../integrations/socket-io/index.js";

type TestSocket = Socket<RealtimeServerEvents, RealtimeClientEvents>;
const createTestSocket = (origin: string, identity: string): TestSocket =>
  createClient(origin, {
    autoConnect: false,
    extraHeaders: { Cookie: `session=${identity}` },
    reconnection: false,
    timeout: 2_000
  });

const waitForConnect = (socket: TestSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });

const waitForWorkspaceReady = (socket: TestSocket): Promise<void> =>
  new Promise((resolve) => {
    socket.once("workspace:ready", resolve);
  });

const waitForDirectMessageReady = (socket: TestSocket, conversationId: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Direct-message subscription timed out."));
    }, 2_000);
    socket.once("direct-message:ready", (payload) => {
      clearTimeout(timeout);
      if (payload.conversationId === conversationId) {
        resolve();
      } else {
        reject(new Error("The server acknowledged a different direct conversation."));
      }
    });
  });

const waitForRealtimeError = (socket: TestSocket): Promise<Readonly<{ event: string; message: string }>> =>
  new Promise((resolve) => {
    socket.once("realtime:error", resolve);
  });

void test("authorizes direct-message rooms and delivers only to conversation participants", async () => {
  const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const identities = new Map([
    ["alice", { id: "alice", name: "Alice", email: "alice@example.test", image: null }],
    ["bob", { id: "bob", name: "Bob", email: "bob@example.test", image: null }],
    ["charlie", { id: "charlie", name: "Charlie", email: "charlie@example.test", image: null }]
  ]);
  const conversation: DirectConversationWithParticipant = {
    id: "dm-1",
    workspaceId: "workspace-1",
    pairKey: '["alice","bob"]',
    participantIds: ["alice", "bob"],
    createdAt: new Date("2026-10-20T00:00:00.000Z"),
    lastActivityAt: new Date("2026-10-20T00:00:00.000Z"),
    otherParticipant: { id: "bob", name: "Bob", image: null }
  };
  const service: Pick<DirectMessageService, "get"> = {
    get: (workspaceId, conversationId, userId) => Promise.resolve(
      workspaceId === "workspace-1" && conversationId === conversation.id
        && conversation.participantIds.includes(userId)
        ? { kind: "found" as const, conversation: { ...conversation, otherParticipant: {
          id: conversation.participantIds.find((participantId) => participantId !== userId) ?? "unknown",
          name: "Conversation member",
          image: null
        } } }
        : { kind: "not-found" as const }
    )
  };
  const httpServer = createServer();
  const socketIo = createSocketIoIntegration({
    webOrigin: "http://localhost:3000",
    logger,
    getIdentity: (headers) => {
      const cookie = headers.cookie;
      const session = typeof cookie === "string" ? cookie.match(/(?:^|;\s*)session=([^;]+)/)?.[1] : undefined;
      return Promise.resolve(session ? identities.get(session) ?? null : null);
    }
  });
  const channelService: Pick<WorkspaceChannelService, "getForMember"> = {
    getForMember: () => Promise.resolve(null)
  };
  createWorkspaceChannelRealtime({
    socketIo,
    channelService,
    getWorkspaceAccess: (_identity, workspaceId) =>
      Promise.resolve(workspaceId === "workspace-1" ? "allowed" : "denied"),
    logger
  });
  const realtime = createDirectMessageRealtime({ socketIo, service, logger });
  socketIo.attach(httpServer);
  httpServer.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Direct-message test server did not bind.");
  const origin = `http://127.0.0.1:${address.port.toString()}`;
  const alice = createTestSocket(origin, "alice");
  const bob = createTestSocket(origin, "bob");
  const charlie = createTestSocket(origin, "charlie");

  try {
    const connects = [waitForConnect(alice), waitForConnect(bob), waitForConnect(charlie)];
    alice.connect();
    bob.connect();
    charlie.connect();
    await Promise.all(connects);

    const workspaceReady = [
      waitForWorkspaceReady(alice),
      waitForWorkspaceReady(bob),
      waitForWorkspaceReady(charlie)
    ];
    alice.emit("workspace:subscribe", "workspace-1");
    bob.emit("workspace:subscribe", "workspace-1");
    charlie.emit("workspace:subscribe", "workspace-1");
    await Promise.all(workspaceReady);

    const ready = [waitForDirectMessageReady(alice, "dm-1"), waitForDirectMessageReady(bob, "dm-1")];
    alice.emit("direct-message:subscribe", "dm-1");
    bob.emit("direct-message:subscribe", "dm-1");
    await Promise.all(ready);

    const denied = waitForRealtimeError(charlie);
    charlie.emit("direct-message:subscribe", "dm-1");
    assert.equal((await denied).event, "direct-message:subscribe");

    const message: DirectMessageResponse = {
      id: "message-1",
      conversationId: "dm-1",
      senderId: "alice",
      text: "Private",
      createdAt: "2026-10-20T00:00:01.000Z",
      attachments: [],
      sender: { id: "alice", name: "Alice", image: null }
    };
    const received = new Promise<DirectMessageResponse>((resolve) => bob.once("direct-message:new", resolve));
    let leaked = false;
    charlie.once("direct-message:new", () => { leaked = true; });
    realtime.publishDirectMessage("workspace-1", "dm-1", message);
    assert.deepEqual(await received, message);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(leaked, false);
  } finally {
    alice.disconnect();
    bob.disconnect();
    charlie.disconnect();
    await socketIo.close();
  }
});
