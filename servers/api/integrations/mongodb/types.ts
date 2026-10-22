import type mongoose from "mongoose";
import type { ClientSession } from "mongoose";

export type MongoDatabase = NonNullable<typeof mongoose.connection.db>;
export type MongoTransactionSession = ClientSession;
export type MongoTransactionOperation<Result> = (session: ClientSession) => Promise<Result>;
export type MongoTransaction = <Result>(operation: MongoTransactionOperation<Result>) => Promise<Result>;

export type MongoClient = Readonly<{
  connect: (uri: string) => Promise<unknown>;
  disconnect: () => Promise<void>;
  getDatabase: () => MongoDatabase;
  withTransaction: MongoTransaction;
}>;

export type MongoDbIntegration = Readonly<{
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  getDatabase: () => MongoDatabase;
  withTransaction: MongoTransaction;
}>;
