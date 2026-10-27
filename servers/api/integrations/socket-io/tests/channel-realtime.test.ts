import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { io as createClient, type Socket } from "socket.io-client";
import type { Logger } from "@workspace/logging";
import type { RealtimeClientEvents, RealtimeServerEvents } from "@workspace/types";
import { createChannelRealtime } from "../../../features/channels/index.js";
import type { ChannelService } from "../../../features/channels/index.js";
import { createSocketIoIntegration } from "../index.js";

type TestSocket = Socket<RealtimeServerEvents, RealtimeClientEvents>;

const createTestSocket = (origin: string, identity: string): TestSocket =>
  createClient(origin, {
    autoConnect: false,
    extraHeaders: { Cookie: `session=${identity}`, Origin: "http://localhost:3000" },
    reconnection: false,
    transports: ["websocket"],
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

const waitForChannelReady = (socket: TestSocket, channelId: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Channel subscription timed out."));
    }, 2_000);
    socket.once("channel:ready", (payload) => {
      clearTimeout(timeout);
      if (payload.channelId === channelId) resolve();
      else reject(new Error("The server acknowledged a different channel."));
    });
  });

const waitForRealtimeError = (socket: TestSocket): Promise<Readonly<{ event: string; message: string }>> =>
  new Promise((resolve) => {
    socket.once("realtime:error", resolve);
  });

void test("authenticates sockets and scopes live channel events to workspace members", async () => {
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
  const identities = new Map([
    ["alice", { id: "alice", name: "Alice", email: "alice@example.test", image: null }],
    ["bob", { id: "bob", name: "Bob", email: "bob@example.test", image: null }],
    ["workspace-member", {
      id: "workspace-member",
      name: "Workspace Member",
      email: "member@example.test",
      image: null
    }],
    ["outsider", { id: "outsider", name: "Outsider", email: "outsider@example.test", image: null }]
  ]);
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
  const channel = {
    id: "channel-1",
    workspaceId: "workspace-1",
    name: "general",
    description: null,
    visibility: "private",
    lifecycleState: "active",
    createdBy: "alice",
    createdAt: new Date("2026-10-16T00:00:00.000Z"),
    updatedAt: new Date("2026-10-16T00:00:00.000Z"),
    archivedAt: null
  } as const;
  const channelService: Pick<ChannelService, "getForMember"> = {
    getForMember: (workspaceId, channelId, userId) =>
      Promise.resolve(workspaceId === channel.workspaceId
        && channelId === channel.id
        && userId !== "workspace-member"
        ? channel
        : null)
  };
  const realtime = createChannelRealtime({
    socketIo,
    channelService,
    getWorkspaceAccess: (identity, workspaceId) =>
      Promise.resolve(workspaceId === "workspace-1" && identity.id !== "outsider" ? "allowed" : "denied"),
    logger
  });
  socketIo.attach(httpServer);
  httpServer.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Socket test server did not bind to a TCP port.");
  const origin = `http://127.0.0.1:${address.port.toString()}`;
  const alice = createTestSocket(origin, "alice");
  const bob = createTestSocket(origin, "bob");
  const privateViewer = createTestSocket(origin, "workspace-member");
  const outsider = createTestSocket(origin, "outsider");

  try {
    const aliceConnected = waitForConnect(alice);
    const bobConnected = waitForConnect(bob);
    alice.connect();
    bob.connect();
    await Promise.all([aliceConnected, bobConnected]);

    const aliceWorkspaceReady = waitForWorkspaceReady(alice);
    const bobWorkspaceReady = waitForWorkspaceReady(bob);
    const presenceChanged = new Promise<Readonly<{ userId: string; online: boolean }>>((resolve) => {
      alice.on("workspace:presence:changed", (presence) => {
        if (presence.userId === "bob") resolve(presence);
      });
    });
    alice.emit("workspace:subscribe", "workspace-1");
    bob.emit("workspace:subscribe", "workspace-1");
    await Promise.all([aliceWorkspaceReady, bobWorkspaceReady]);
    assert.deepEqual(await presenceChanged, { userId: "bob", online: true });

    const aliceChannelReady = waitForChannelReady(alice, "channel-1");
    const bobChannelReady = waitForChannelReady(bob, "channel-1");
    alice.emit("channel:subscribe", "channel-1");
    bob.emit("channel:subscribe", "channel-1");
    await Promise.all([aliceChannelReady, bobChannelReady]);

    const typing = new Promise<Readonly<{ channelId: string; userId: string; active: boolean }>>((resolve) =>
      bob.once("channel:typing", resolve));
    alice.emit("channel:typing", { channelId: "channel-1", active: true });
    assert.deepEqual(await typing, { channelId: "channel-1", userId: "alice", active: true });

    const message = {
      id: "message-1",
      channelId: "channel-1",
      senderId: "alice",
      text: "Live from the server",
      createdAt: "2026-10-16T00:00:01.000Z",
      reactions: [],
      sender: { id: "alice", name: "Alice", image: null }
    };
    const receivedMessage = new Promise((resolve) => bob.once("channel:message:new", resolve));
    realtime.publishMessage("workspace-1", "channel-1", message);
    assert.deepEqual(await receivedMessage, message);

    const receivedDeletion = new Promise((resolve) => bob.once("channel:message:deleted", resolve));
    realtime.publishMessageDeleted("workspace-1", "channel-1", "message-1");
    assert.deepEqual(await receivedDeletion, { channelId: "channel-1", messageId: "message-1" });

    const changedMembers = new Promise((resolve) => bob.once("channel:members:changed", resolve));
    realtime.publishMembersChanged("workspace-1", "channel-1");
    assert.deepEqual(await changedMembers, { channelId: "channel-1" });

    const changedChannels = new Promise<void>((resolve) => bob.once("workspace:channels:changed", resolve));
    realtime.publishChannelListChanged("workspace-1");
    await changedChannels;

    const changedWorkspaceMembers = new Promise<void>((resolve) => bob.once("workspace:members:changed", resolve));
    realtime.publishWorkspaceMembersChanged("workspace-1");
    await changedWorkspaceMembers;

    const revoked = new Promise((resolve) => bob.once("channel:access:revoked", resolve));
    realtime.revokeChannelAccess("workspace-1", "channel-1", "bob");
    assert.deepEqual(await revoked, { workspaceId: "workspace-1", channelId: "channel-1" });

    const outsiderConnected = waitForConnect(outsider);
    const privateViewerConnected = waitForConnect(privateViewer);
    outsider.connect();
    privateViewer.connect();
    await Promise.all([outsiderConnected, privateViewerConnected]);
    const denied = waitForRealtimeError(outsider);
    outsider.emit("workspace:subscribe", "workspace-1");
    assert.equal((await denied).event, "workspace:subscribe");

    const privateViewerReady = waitForWorkspaceReady(privateViewer);
    privateViewer.emit("workspace:subscribe", "workspace-1");
    await privateViewerReady;
    const privateChannelDenied = waitForRealtimeError(privateViewer);
    privateViewer.emit("channel:subscribe", "channel-1");
    assert.equal((await privateChannelDenied).event, "channel:subscribe");
    let privateMessageReceived = false;
    privateViewer.once("channel:message:new", () => { privateMessageReceived = true; });
    realtime.publishMessage("workspace-1", "channel-1", message);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(privateMessageReceived, false);

    const workspaceRevoked = new Promise((resolve) => alice.once("workspace:access:revoked", resolve));
    realtime.revokeWorkspaceAccess("workspace-1", "alice");
    assert.deepEqual(await workspaceRevoked, { workspaceId: "workspace-1" });
  } finally {
    alice.disconnect();
    bob.disconnect();
    privateViewer.disconnect();
    outsider.disconnect();
    await socketIo.close();
  }
});

void test("rejects Socket.IO connections without an authenticated session", async () => {
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
  const httpServer = createServer();
  const socketIo = createSocketIoIntegration({
    webOrigin: "http://localhost:3000",
    logger,
    getIdentity: () => Promise.resolve(null)
  });
  socketIo.attach(httpServer);
  httpServer.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Socket test server did not bind to a TCP port.");
  const client = createClient(`http://127.0.0.1:${address.port.toString()}`, {
    autoConnect: false,
    extraHeaders: { Origin: "http://localhost:3000" },
    reconnection: false,
    timeout: 2_000
  });
  try {
    const rejected = new Promise<Error>((resolve) => client.once("connect_error", resolve));
    client.connect();
    assert.match((await rejected).message, /Authentication required/);
  } finally {
    client.disconnect();
    await socketIo.close();
  }
});

void test("rejects socket handshakes with a missing or untrusted origin", async () => {
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
  const httpServer = createServer();
  const socketIo = createSocketIoIntegration({
    webOrigin: "http://localhost:3000",
    logger,
    getIdentity: () => Promise.resolve({
      id: "session-user",
      name: "Session User",
      email: "session@example.test",
      image: null
    })
  });
  socketIo.attach(httpServer);
  httpServer.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Socket test server did not bind to a TCP port.");
  const origin = `http://127.0.0.1:${address.port.toString()}`;
  const missingOrigin = createClient(origin, {
    autoConnect: false,
    reconnection: false,
    transports: ["websocket"],
    timeout: 2_000
  });
  const untrustedOrigin = createClient(origin, {
    autoConnect: false,
    extraHeaders: { Origin: "https://attacker.example" },
    reconnection: false,
    transports: ["websocket"],
    timeout: 2_000
  });
  try {
    for (const client of [missingOrigin, untrustedOrigin]) {
      const rejected = new Promise<Error>((resolve) => client.once("connect_error", resolve));
      client.connect();
      assert.match((await rejected).message, /Realtime origin is not allowed/);
    }
  } finally {
    missingOrigin.disconnect();
    untrustedOrigin.disconnect();
    await socketIo.close();
  }
});

void test("disconnects an established socket after its Better Auth session becomes invalid", async () => {
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
  let sessionValid = true;
  const httpServer = createServer();
  const socketIo = createSocketIoIntegration({
    webOrigin: "http://localhost:3000",
    logger,
    sessionRevalidationIntervalMs: 20,
    getIdentity: () => Promise.resolve(sessionValid ? {
      id: "session-user",
      name: "Session User",
      email: "session@example.test",
      image: null
    } : null)
  });
  socketIo.attach(httpServer);
  httpServer.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Socket test server did not bind to a TCP port.");
  const client = createClient(`http://127.0.0.1:${address.port.toString()}`, {
    autoConnect: false,
    extraHeaders: { Cookie: "session=valid", Origin: "http://localhost:3000" },
    reconnection: false,
    transports: ["websocket"],
    timeout: 2_000
  });
  try {
    const connected = waitForConnect(client);
    client.connect();
    await connected;
    sessionValid = false;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Invalid session socket was not disconnected."));
      }, 1_000);
      client.once("disconnect", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  } finally {
    client.disconnect();
    await socketIo.close();
  }
});

void test("limits concurrent sockets per user and client IP", async () => {
  const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const httpServer = createServer();
  const socketIo = createSocketIoIntegration({
    webOrigin: "http://localhost:3000",
    logger,
    limits: { connectionsPerUser: 1, connectionsPerIp: 2 },
    getIdentity: (headers) => {
      const cookie = headers.cookie;
      const userId = typeof cookie === "string" ? cookie.replace("session=", "") : "";
      return Promise.resolve({
        id: userId,
        name: userId,
        email: `${userId}@example.test`,
        image: null
      });
    }
  });
  socketIo.attach(httpServer);
  httpServer.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Socket test server did not bind to a TCP port.");
  const origin = `http://127.0.0.1:${address.port.toString()}`;
  const createLimitedClient = (userId: string): TestSocket => createClient(origin, {
    autoConnect: false,
    extraHeaders: { Cookie: `session=${userId}`, Origin: "http://localhost:3000" },
    reconnection: false,
    transports: ["websocket"],
    timeout: 2_000
  });
  const first = createLimitedClient("same-user");
  const duplicateUser = createLimitedClient("same-user");
  const otherUser = createLimitedClient("other-user");
  const overIpLimit = createLimitedClient("third-user");
  try {
    const firstConnected = waitForConnect(first);
    first.connect();
    await firstConnected;

    const userRejected = new Promise<Error>((resolve) => duplicateUser.once("connect_error", resolve));
    duplicateUser.connect();
    assert.match((await userRejected).message, /connection limit reached/i);

    const otherConnected = waitForConnect(otherUser);
    otherUser.connect();
    await otherConnected;

    const ipRejected = new Promise<Error>((resolve) => overIpLimit.once("connect_error", resolve));
    overIpLimit.connect();
    assert.match((await ipRejected).message, /connection limit reached/i);
  } finally {
    first.disconnect();
    duplicateUser.disconnect();
    otherUser.disconnect();
    overIpLimit.disconnect();
    await socketIo.close();
  }
});

void test("disconnects users who exceed the inbound event rate and bounds Socket.IO packets", async () => {
  const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const httpServer = createServer();
  const socketIo = createSocketIoIntegration({
    webOrigin: "http://localhost:3000",
    logger,
    limits: { eventsPerUserPerSecond: 2 },
    getIdentity: () => Promise.resolve({
      id: "event-user",
      name: "Event User",
      email: "event@example.test",
      image: null
    })
  });
  socketIo.attach(httpServer);
  httpServer.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Socket test server did not bind to a TCP port.");
  assert.equal(socketIo.io.engine.opts.maxHttpBufferSize, 16 * 1024);
  const origin = `http://127.0.0.1:${address.port.toString()}`;
  const client = createTestSocket(origin, "event-user");
  const oversizedClient = createTestSocket(origin, "event-user");
  try {
    const connected = waitForConnect(client);
    client.connect();
    await connected;
    const disconnected = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Event-flooded socket was not disconnected."));
      }, 1_000);
      client.once("disconnect", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    client.emit("workspace:subscribe", "workspace-1");
    client.emit("workspace:subscribe", "workspace-1");
    client.emit("workspace:subscribe", "workspace-1");
    await disconnected;

    const oversizedConnected = waitForConnect(oversizedClient);
    oversizedClient.connect();
    await oversizedConnected;
    const oversizedDisconnected = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Oversized socket payload was not rejected."));
      }, 1_000);
      oversizedClient.once("disconnect", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    oversizedClient.emit("workspace:subscribe", "x".repeat(20 * 1024));
    await oversizedDisconnected;
  } finally {
    client.disconnect();
    oversizedClient.disconnect();
    await socketIo.close();
  }
});
