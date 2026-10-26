import type { SharedRateLimiter } from "../integrations/mongodb/index.js";

export const allowApiRateLimit: SharedRateLimiter = Object.freeze({
  consume: () => Promise.resolve(Object.freeze({ allowed: true, retryAfterSeconds: 0 }))
});
