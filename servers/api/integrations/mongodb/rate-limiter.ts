import { createHash, randomUUID } from "node:crypto";
import type { MongoDatabase, MongoRateLimiter } from "./types.js";

type RateLimitEvent = Readonly<{ at: Date; token: string }>;
type RateLimitRecord = Readonly<{
  _id: string;
  events: readonly RateLimitEvent[];
  expiresAt: Date;
}>;

type MongoRateLimiterDependencies = Readonly<{
  database: MongoDatabase;
  now?: () => number;
  createToken?: () => string;
}>;

const COLLECTION_NAME = "api_rate_limits";

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === 11000;

const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex");

export const createMongoRateLimiter = ({
  database,
  now = Date.now,
  createToken = randomUUID
}: MongoRateLimiterDependencies): MongoRateLimiter => {
  const collection = database.collection<RateLimitRecord>(COLLECTION_NAME);

  const consume = async (key: string, limit: number, windowMs: number) => {
    if (!key || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new RangeError("Rate-limit keys, limits, and windows must be valid.");
    }
    const currentTime = now();
    const currentDate = new Date(currentTime);
    const cutoff = new Date(currentTime - windowMs);
    const token = createToken();
    const event: RateLimitEvent = Object.freeze({ at: currentDate, token });
    const eventsExpression = {
      $let: {
        vars: {
          active: {
            $filter: {
              input: { $ifNull: ["$events", []] },
              as: "event",
              cond: { $gt: ["$$event.at", cutoff] }
            }
          }
        },
        in: {
          $cond: [
            { $lt: [{ $size: "$$active" }, limit] },
            { $concatArrays: ["$$active", [{ $literal: event }]] },
            "$$active"
          ]
        }
      }
    };
    const update = [
      { $set: { events: eventsExpression } },
      {
        $set: {
          expiresAt: {
            $add: [
              { $max: { $map: { input: "$events", as: "event", in: "$$event.at" } } },
              windowMs
            ]
          }
        }
      }
    ];
    const options = { upsert: true, returnDocument: "after" as const };
    const filter = { _id: hashKey(key) };

    let record: RateLimitRecord | null;
    try {
      record = await collection.findOneAndUpdate(filter, update, options);
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) throw error;
      record = await collection.findOneAndUpdate(filter, update, { returnDocument: "after" });
    }
    if (!record || record.events.length === 0) {
      throw new Error("MongoDB did not return the updated rate-limit record.");
    }
    if (record.events.some(({ token: storedToken }) => storedToken === token)) {
      return Object.freeze({ allowed: true, retryAfterSeconds: 0 });
    }
    const oldestEvent = Math.min(...record.events.map(({ at }) => at.getTime()));
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestEvent + windowMs - currentTime) / 1_000));
    return Object.freeze({ allowed: false, retryAfterSeconds });
  };

  return Object.freeze({
    ensureIndexes: async (): Promise<void> => {
      await collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: "api_rate_limits_expiry" }
      );
    },
    consume
  });
};
