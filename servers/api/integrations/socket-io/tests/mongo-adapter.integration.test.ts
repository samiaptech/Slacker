import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { io as createClient, type Socket } from "socket.io-client";
import type { Logger } from "@workspace/logging";
import type { RealtimeClientEvents, RealtimeServerEvents } from "@workspace/types";
import { createMongoDbIntegration } from "../../mongodb/index.js";
import { createSocketIoIntegration } from "../index.js";

const mongoTestUri = process.env.MONGODB_TEST_URI;
type TestSocket = Socket<RealtimeServerEvents, RealtimeClientEvents>;

void test("broadcasts realtime events across Socket.IO instances through MongoDB", {
  skip: !mongoTestUri
}, async () => {
  if (!mongoTestUri) return;
  const databaseName = decodeURIComponent(new URL(mongoTestUri).pathname.slice(1));
  if (!/^nutshyll_test_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error("MONGODB_TEST_URI must target a database named nutshyll_test_<name>.");
  }

  const logger: Logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
  const mongo = createMongoDbIntegration({ uri: mongoTestUri, logger });
  await mongo.connect();
  const collection = mongo.getDatabase().collection(`socket_io_adapter_test_${randomUUID()}`);
  await collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });

  const createInstance = async (): Promise<Readonly<{
    socketIo: ReturnType<typeof createSocketIoIntegration>;
    client: TestSocket;
  }>> => {
    const socketIo = createSocketIoIntegration({
      webOrigin: "http://localhost:3000",
      getIdentity: () => Promise.resolve({
        id: "test-user",
        name: "Test User",
        email: "test@example.test",
        image: null
      }),
      logger,
      adapterCollection: collection
    });
    socketIo.io.on("connection", (socket) => {
      void socket.join("shared-test-room");
    });
    const server = createServer();
    socketIo.attach(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Socket test server did not bind to a TCP port.");
    return {
      socketIo,
      client: createClient(`http://127.0.0.1:${address.port.toString()}`, {
        autoConnect: false,
        extraHeaders: { Origin: "http://localhost:3000" },
        reconnection: false,
        transports: ["websocket"],
        timeout: 3_000
      })
    };
  };

  const senderInstance = await createInstance();
  const receiverInstance = await createInstance();
  try {
    const connected = new Promise<void>((resolve, reject) => {
      receiverInstance.client.once("connect", resolve);
      receiverInstance.client.once("connect_error", reject);
    });
    receiverInstance.client.connect();
    await connected;

    const message = {
      id: "cross-instance-message",
      channelId: "test-channel",
      senderId: "test-user",
      text: "Delivered across instances",
      createdAt: new Date().toISOString(),
      reactions: [],
      sender: { id: "test-user", name: "Test User", image: null }
    };
    const received = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Cross-instance broadcast timed out."));
      }, 5_000);
      receiverInstance.client.once("channel:message:new", (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });
    });
    senderInstance.socketIo.io.to("shared-test-room").emit("channel:message:new", message);

    assert.deepEqual(await received, message);
  } finally {
    senderInstance.client.disconnect();
    receiverInstance.client.disconnect();
    await senderInstance.socketIo.close();
    await receiverInstance.socketIo.close();
    await collection.deleteMany({});
    await mongo.disconnect();
  }
});
