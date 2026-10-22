import test from "node:test";
import assert from "node:assert/strict";
import type { MongoDatabase, MongoTransaction } from "../../../integrations/mongodb/index.js";
import {
  DIRECT_CONVERSATIONS_COLLECTION,
  DIRECT_CONVERSATIONS_COLLECTION_VALIDATOR,
  DIRECT_CONVERSATIONS_INDEXES,
  DIRECT_MESSAGES_COLLECTION,
  DIRECT_MESSAGES_COLLECTION_VALIDATOR,
  DIRECT_MESSAGES_INDEXES
} from "../models/index.js";
import { createMongoDirectMessageStorage } from "../integrations/index.js";

const collectionDefinitions = [
  {
    name: DIRECT_CONVERSATIONS_COLLECTION,
    validator: DIRECT_CONVERSATIONS_COLLECTION_VALIDATOR,
    indexes: DIRECT_CONVERSATIONS_INDEXES
  },
  {
    name: DIRECT_MESSAGES_COLLECTION,
    validator: DIRECT_MESSAGES_COLLECTION_VALIDATOR,
    indexes: DIRECT_MESSAGES_INDEXES
  }
];

void test("accepts MongoDB's normalized direct-message text index during readiness checks", async () => {
  let metadataReads = 0;
  let indexReads = 0;
  const database = {
    listCollections: ({ name }: Readonly<{ name: string }>) => ({
      next: () => {
        metadataReads += 1;
        const definition = collectionDefinitions.find((collection) => collection.name === name);
        return Promise.resolve(definition
          ? { name, options: { validator: definition.validator } }
          : null);
      }
    }),
    collection: (name: string) => ({
      indexes: () => {
        indexReads += 1;
        return Promise.resolve(
            collectionDefinitions.find((collection) => collection.name === name)?.indexes.map((index) => ({
            name: index.options.name,
            key: Object.values(index.keys).includes("text")
              ? { _fts: "text", _ftsx: 1 }
            : index.keys,
            ...(Object.values(index.keys).includes("text") ? { weights: { text: 1 } } : {}),
            unique: index.options.unique
            })) ?? []
        );
      },
      find: () => ({
        sort: () => ({
          limit: () => ({ toArray: () => Promise.resolve([]) })
        })
      })
    })
  } as unknown as MongoDatabase;
  const withTransaction: MongoTransaction = (operation) => operation({} as never);

  const storage = createMongoDirectMessageStorage(database, withTransaction);
  const result = await storage.listForMember("workspace-1", "user-1");
  await storage.listForMember("workspace-1", "user-1");
  await storage.listForMember("workspace-1", "user-1");

  assert.deepEqual(result, []);
  assert.equal(metadataReads, 2);
  assert.equal(indexReads, 2);
});
