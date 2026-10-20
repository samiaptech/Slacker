import test from "node:test";
import assert from "node:assert/strict";
import type { Logger } from "@workspace/logging";
import { createMongoDbIntegration, type MongoClient, type MongoTransaction, type MongoTransactionOperation } from "../integrations/index.js";

void test("composes the server-owned MongoDB integration when configured", async (): Promise<void> => {
  const calls: string[] = [];
  const withTransaction: MongoTransaction = <Result>(operation: MongoTransactionOperation<Result>) => operation({} as never);
  const client: MongoClient = {
    connect: (uri): Promise<void> => {
      calls.push(`connect:${uri}`);
      return Promise.resolve();
    },
    disconnect: (): Promise<void> => {
      calls.push("disconnect");
      return Promise.resolve();
    },
    getDatabase: () => ({}) as ReturnType<MongoClient["getDatabase"]>,
    withTransaction
  };
  const logger: Logger = {
    info: (message): void => { calls.push(`log:${message}`); },
    warn: (): void => undefined,
    error: (): void => undefined
  };
  const integration = createMongoDbIntegration({
    uri: "mongodb://example.test/workspace",
    client,
    logger
  });

  await integration.connect();
  assert.deepEqual(integration.getDatabase(), {});
  assert.equal(await integration.withTransaction(() => Promise.resolve("committed")), "committed");
  await integration.disconnect();

  assert.deepEqual(calls, [
    "connect:mongodb://example.test/workspace",
    "log:MongoDB connection established.",
    "disconnect"
  ]);
});
