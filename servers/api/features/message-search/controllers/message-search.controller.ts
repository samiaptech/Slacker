import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import { z } from "zod";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import { createApplicationError } from "../../../errors/index.js";
import type { MessageSearchService } from "../services/index.js";
import {
  MESSAGE_SEARCH_MAX_PAGE,
  MESSAGE_SEARCH_MAX_QUERY_LENGTH
} from "../domain/index.js";

type MessageSearchIdentity = Readonly<{ id: string; name: string; email: string; image: string | null }>;
type WorkspaceAccess =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "allowed"; access: Readonly<{ workspace: Readonly<{ id: string }> }> }>;

export type MessageSearchControllerDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<MessageSearchIdentity | null>;
  getWorkspaceAccess: (identity: MessageSearchIdentity | null, workspaceId: string | null) => Promise<WorkspaceAccess>;
  service: MessageSearchService;
}>;

const requestSchema = z.object({
  query: z.string().trim().min(2).max(MESSAGE_SEARCH_MAX_QUERY_LENGTH),
  page: z.number().int().min(1).max(MESSAGE_SEARCH_MAX_PAGE).default(1)
}).strict();

const createError = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status: (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS]
) => createApplicationError({ code: ERROR_CODES[code], message, status });

export const createMessageSearchController = ({
  getIdentity,
  getWorkspaceAccess,
  service
}: MessageSearchControllerDependencies): RequestHandler => async (request, response, next): Promise<void> => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const identity = await getIdentity(request.headers);
    if (!identity) {
      next(createError("unauthenticated", ERROR_MESSAGES.unauthenticated, HTTP_STATUS.unauthorized));
      return;
    }
    const workspaceIdValue = request.headers["x-workspace-id"];
    const workspaceId = typeof workspaceIdValue === "string" ? workspaceIdValue.trim() || null : null;
    const access = await getWorkspaceAccess(identity, workspaceId);
    if (access.kind === "unauthenticated") {
      next(createError("unauthenticated", ERROR_MESSAGES.unauthenticated, HTTP_STATUS.unauthorized));
      return;
    }
    if (access.kind === "denied") {
      next(createError("workspaceAccessDenied", ERROR_MESSAGES.workspaceAccessDenied, HTTP_STATUS.forbidden));
      return;
    }
    if (access.kind === "unavailable") {
      next(createError("workspaceStorageUnavailable", ERROR_MESSAGES.workspaceStorageUnavailable, HTTP_STATUS.serviceUnavailable));
      return;
    }
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) {
      next(createError("validation", ERROR_MESSAGES.validation, HTTP_STATUS.badRequest));
      return;
    }
    const result = await service.search(
      access.access.workspace.id,
      identity.id,
      parsed.data.query,
      parsed.data.page
    );
    if (result.kind === "invalid") {
      next(createError("validation", ERROR_MESSAGES.validation, HTTP_STATUS.badRequest));
      return;
    }
    if (result.kind === "rate-limited") {
      response.setHeader("Retry-After", String(result.retryAfterSeconds));
      next(createApplicationError({
        code: ERROR_CODES.rateLimited,
        message: ERROR_MESSAGES.rateLimited,
        status: HTTP_STATUS.tooManyRequests,
        details: { retryAfterSeconds: result.retryAfterSeconds }
      }));
      return;
    }
    if (result.kind === "unavailable") {
      next(createError("messageSearchUnavailable", ERROR_MESSAGES.messageSearchUnavailable, HTTP_STATUS.serviceUnavailable));
      return;
    }
    response.status(HTTP_STATUS.ok).json(result.response);
  } catch (error: unknown) {
    next(error);
  }
};
