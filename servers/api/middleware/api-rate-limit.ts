import { isIP } from "node:net";
import type { Request, RequestHandler } from "express";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../constants/index.js";
import { createApplicationError } from "../errors/index.js";
import type { SharedRateLimiter } from "../integrations/mongodb/index.js";

export const API_RATE_LIMIT = 120;
export const API_RATE_WINDOW_MS = 60_000;

const normalizeIp = (value: string): string | null => {
  const trimmed = value.trim();
  if (isIP(trimmed) === 0) return null;
  return trimmed.toLowerCase().startsWith("::ffff:")
    ? trimmed.slice("::ffff:".length)
    : trimmed;
};

export const resolveClientIp = (
  request: Pick<Request, "headers" | "socket">,
  trustVercelForwardedFor: boolean
): string => {
  if (trustVercelForwardedFor) {
    const forwardedValue = request.headers["x-vercel-forwarded-for"];
    const forwardedIp = typeof forwardedValue === "string" ? normalizeIp(forwardedValue) : null;
    if (forwardedIp) return forwardedIp;
  }
  return normalizeIp(request.socket.remoteAddress ?? "") ?? "unknown";
};

type ApiRateLimitDependencies = Readonly<{
  rateLimiter: SharedRateLimiter;
  trustVercelForwardedFor: boolean;
  resolveIp?: (request: Request) => string;
}>;

export const createApiRateLimitMiddleware = ({
  rateLimiter,
  trustVercelForwardedFor,
  resolveIp = (request) => resolveClientIp(request, trustVercelForwardedFor)
}: ApiRateLimitDependencies): RequestHandler => async (request, response, next): Promise<void> => {
  try {
    const decision = await rateLimiter.consume(
      `api:${resolveIp(request)}`,
      API_RATE_LIMIT,
      API_RATE_WINDOW_MS
    );
    if (decision.allowed) {
      next();
      return;
    }
    response.setHeader("Retry-After", String(decision.retryAfterSeconds));
    next(createApplicationError({
      code: ERROR_CODES.apiRateLimited,
      message: ERROR_MESSAGES.apiRateLimited,
      status: HTTP_STATUS.tooManyRequests,
      details: { retryAfterSeconds: decision.retryAfterSeconds }
    }));
  } catch {
    next(createApplicationError({
      code: ERROR_CODES.rateLimitUnavailable,
      message: ERROR_MESSAGES.rateLimitUnavailable,
      status: HTTP_STATUS.serviceUnavailable
    }));
  }
};
