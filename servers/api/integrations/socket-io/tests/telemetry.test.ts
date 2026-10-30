import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { io as createClient } from "socket.io-client";
import type { Logger } from "@workspace/logging";
import type { SocketIoTelemetry } from "../index.js";
import { createSocketIoIntegration } from "../index.js";

void test("records authenticated Socket.IO lifecycle and event boundaries", async () => {
  const attempts: string[] = [];
  const receivedEvents: string[] = [];
  const emittedEvents: string[] = [];
  let openedConnections = 0;
  let resolveClosed: (duration: number) => void = () => undefined;
  const closed = new Promise<number>((resolve) => {
    resolveClosed = resolve;
  });
  const telemetry: SocketIoTelemetry = {
    recordConnectionAttempt: (outcome) => {
      attempts.push(outcome);
    },
    recordConnectionOpened: () => {
      openedConnections += 1;
    },
    recordConnectionClosed: (duration) => {
      resolveClosed(duration);
    },
    recordEvent: (direction, eventName) => {
      if (direction === "received") receivedEvents.push(eventName);
      else emittedEvents.push(eventName);
    },
    recordEventFailure: () => undefined
  };
  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
  const socketIo = createSocketIoIntegration({
    webOrigin: "http://localhost:3000",
    logger,
    telemetry,
    getIdentity: () => Promise.resolve({
      id: "test-user",
      name: "Test User",
      email: "test@example.test",
      image: null
    })
  });
  const httpServer = createServer();
  socketIo.attach(httpServer);
  httpServer.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
  });
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Socket telemetry test server did not bind to a TCP port.");
  }
  const client = createClient(`http://127.0.0.1:${address.port.toString()}`, {
    autoConnect: false,
    extraHeaders: {
      Cookie: "session=test-user",
      Origin: "http://localhost:3000"
    },
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("connect_error", reject);
      client.connect();
    });
    const serverSocket = socketIo.io.sockets.sockets.get(client.id ?? "");
    if (!serverSocket) throw new Error("Connected Socket.IO server socket was not found.");
    await serverSocket.join("metrics-test-room");
    client.emit("workspace:subscribe", "workspace-secret");
    const workspaceReady = new Promise<void>((resolve) => client.once("workspace:ready", resolve));
    socketIo.io.to("metrics-test-room").emit("workspace:ready");
    await workspaceReady;
    client.disconnect();
    const duration = await closed;
    assert.deepEqual(attempts, ["success"]);
    assert.equal(openedConnections, 1);
    assert.deepEqual(receivedEvents, ["workspace:subscribe"]);
    assert.deepEqual(emittedEvents, ["workspace:ready"]);
    assert.ok(duration >= 0);
  } finally {
    client.disconnect();
    await socketIo.close();
  }
});
