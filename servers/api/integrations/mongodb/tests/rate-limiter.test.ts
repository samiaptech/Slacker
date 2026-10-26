import test from "node:test";
import assert from "node:assert/strict";
import type { MongoDatabase } from "../types.js";
import { createMongoRateLimiter } from "../rate-limiter.js";

type Event = Readonly<{ at: Date; token: string }>;
type RateLimitRecord = Readonly<{ _id: string; events: readonly Event[]; expiresAt: Date }>;

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
const asArray = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

const createAtomicDatabase = () => {
  const records = new Map<string, RateLimitRecord>();
  const indexCalls: unknown[] = [];
  let pending = Promise.resolve();
  let operationCount = 0;
  const database = {
    collection: () => ({
      createIndex: (keys: unknown, options: unknown) => {
        indexCalls.push({ keys, options });
        return Promise.resolve("api_rate_limits_expiry");
      },
      findOneAndUpdate: (filter: unknown, update: unknown, _options?: unknown) => {
        const operation = pending.then(() => {
          operationCount += 1;
          const filterId = asObject(filter)._id;
          if (typeof filterId !== "string") throw new Error("Missing rate-limit document key.");
          const stages = asArray(update).map(asObject);
          const firstSet = asObject(stages[0]?.$set);
          const eventLet = asObject(asObject(firstSet.events).$let);
          const vars = asObject(eventLet.vars);
          const activeFilter = asObject(asObject(vars.active).$filter);
          const cutoff = asArray(asObject(activeFilter.cond).$gt)[1];
          const eventCondition = asArray(asObject(eventLet.in).$cond);
          const conditionLimit = asArray(asObject(eventCondition[0]).$lt)[1];
          const appendExpression = asObject(asObject(eventCondition[1]).$concatArrays);
          const appendParts = asArray(appendExpression);
          const literalEvent = asObject(asArray(appendParts[1])[0]).$literal;
          if (!(cutoff instanceof Date) || typeof conditionLimit !== "number") {
            throw new Error("MongoDB rate-limit update pipeline changed unexpectedly.");
          }
          const event = asObject(literalEvent);
          if (!(event.at instanceof Date) || typeof event.token !== "string") {
            throw new Error("MongoDB rate-limit update event is invalid.");
          }
          const previous = records.get(filterId);
          const activeEvents = (previous?.events ?? []).filter(({ at }) => at > cutoff);
          const events = activeEvents.length < conditionLimit
            ? [...activeEvents, { at: event.at, token: event.token }]
            : activeEvents;
          const expiresAt = new Date(Math.max(...events.map(({ at }) => at.getTime())) + 60_000);
          const record: RateLimitRecord = Object.freeze({ _id: filterId, events: Object.freeze(events), expiresAt });
          records.set(filterId, record);
          return Promise.resolve(record);
        });
        pending = operation.then(() => undefined, () => undefined);
        return operation;
      }
    })
  };
  return {
    database: database as unknown as MongoDatabase,
    records,
    indexCalls,
    get operationCount() { return operationCount; }
  };
};

void test("enforces one shared rolling-window limit with atomic MongoDB updates across instances", async () => {
  let currentTime = 100_000;
  let token = 0;
  const sharedDatabase = createAtomicDatabase();
  const createLimiter = () => createMongoRateLimiter({
    database: sharedDatabase.database,
    now: () => currentTime,
    createToken: () => `request-${String(++token)}`
  });
  const firstInstance = createLimiter();
  const secondInstance = createLimiter();

  await firstInstance.ensureIndexes();
  const results = await Promise.all(Array.from({ length: 60 }, (_, index) =>
    (index % 2 === 0 ? firstInstance : secondInstance).consume("message-search:user-1", 30, 60_000)
  ));

  assert.equal(results.filter(({ allowed }) => allowed).length, 30);
  assert.equal(results.filter(({ allowed }) => !allowed).length, 30);
  assert.ok(results.filter(({ allowed }) => !allowed).every(({ retryAfterSeconds }) => retryAfterSeconds === 60));
  assert.equal(sharedDatabase.operationCount, 60);
  assert.equal(sharedDatabase.records.size, 1);
  assert.equal([...sharedDatabase.records.keys()][0]?.includes("message-search:user-1"), false);
  assert.deepEqual(sharedDatabase.indexCalls, [{
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0, name: "api_rate_limits_expiry" }
  }]);

  assert.equal((await firstInstance.consume("message-search:user-2", 30, 60_000)).allowed, true);
  currentTime += 60_001;
  assert.equal((await secondInstance.consume("message-search:user-1", 30, 60_000)).allowed, true);
  const storedRecord = [...sharedDatabase.records.values()].find(({ events }) =>
    events.some(({ token: storedToken }) => storedToken === "request-62"));
  assert.ok(storedRecord);
  assert.equal(storedRecord.events.length, 1);
});

void test("uses a rolling cutoff and does not extend denied requests", async () => {
  let currentTime = 10_000;
  let token = 0;
  const sharedDatabase = createAtomicDatabase();
  const limiter = createMongoRateLimiter({
    database: sharedDatabase.database,
    now: () => currentTime,
    createToken: () => `token-${String(++token)}`
  });
  await limiter.consume("ip:192.0.2.1", 1, 60_000);
  currentTime += 59_500;
  assert.deepEqual(await limiter.consume("ip:192.0.2.1", 1, 60_000), {
    allowed: false,
    retryAfterSeconds: 1
  });
  currentTime += 500;
  assert.equal((await limiter.consume("ip:192.0.2.1", 1, 60_000)).allowed, true);
});
