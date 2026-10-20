import mongoose from "mongoose";
import type { ClientSession } from "mongoose";
import type { Logger } from "@workspace/logging";
import type { MongoClient, MongoDatabase, MongoDbIntegration } from "./types.js";

type MongoDbIntegrationDependencies = Readonly<{
  uri: string;
  logger: Logger;
  client?: MongoClient;
}>;

const mongooseClient: MongoClient = Object.freeze({
  connect: (uri: string): Promise<unknown> => mongoose.connect(uri),
  disconnect: (): Promise<void> => mongoose.disconnect(),
  getDatabase: () => {
    const database = mongoose.connection.db;
    if (!database) throw new Error("MongoDB must be connected before its database is used.");
    return database;
  },
  withTransaction: async <Result>(operation: (session: ClientSession) => Promise<Result>): Promise<Result> => {
    const session = await mongoose.startSession();
    let result: Readonly<{ value: Result }> | undefined;
    try {
      await session.withTransaction(async () => {
        result = Object.freeze({ value: await operation(session) });
      });
      if (!result) throw new Error("MongoDB transaction did not run its operation.");
      return result.value;
    } finally {
      await session.endSession();
    }
  }
});

export const createMongoDbIntegration = ({
  uri,
  logger,
  client = mongooseClient
}: MongoDbIntegrationDependencies): MongoDbIntegration => Object.freeze({
  connect: async (): Promise<void> => {
    await client.connect(uri);
    logger.info("MongoDB connection established.");
  },
  disconnect: async (): Promise<void> => {
    await client.disconnect();
  },
  getDatabase: (): MongoDatabase => client.getDatabase(),
  withTransaction: <Result>(operation: (session: ClientSession) => Promise<Result>): Promise<Result> =>
    client.withTransaction(operation)
});
