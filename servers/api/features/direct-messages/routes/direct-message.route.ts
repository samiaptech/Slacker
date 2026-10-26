import type { IncomingHttpHeaders } from "node:http";
import { Router, type RequestHandler, type Router as ExpressRouter } from "express";
import multer from "multer";
import { createApplicationError } from "../../../errors/index.js";
import type { ChatAttachmentIntegration } from "../../../integrations/index.js";
import { CHAT_ATTACHMENT_MAX_BYTES, CHAT_ATTACHMENT_MAX_FILES } from "../../../integrations/cloudinary/index.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import {
  createGetDirectMessageController,
  createListDirectMessageHistoryController,
  createListDirectMessagesController,
  createOpenDirectMessageController,
  createSendDirectMessageController,
  createAuthorizeDirectMessageUploadController,
  createDownloadDirectMessageAttachmentController,
  createDeleteDirectMessageController
} from "../controllers/index.js";
import type { DirectMessageService } from "../services/index.js";
import type { DirectMessageRealtimePublisher } from "../realtime/index.js";
import type { NotificationService } from "../../notifications/public/index.js";

type DirectMessageIdentity = Readonly<{ id: string; name: string; email: string; image: string | null }>;
type DirectWorkspaceAccessResult =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "allowed"; access: Readonly<{ workspace: Readonly<{ id: string; role: "admin" | "member" }> }> }>;

export type DirectMessageRouteDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<DirectMessageIdentity | null>;
  getWorkspaceAccess: (
    identity: DirectMessageIdentity | null,
    workspaceId: string | null
  ) => Promise<DirectWorkspaceAccessResult>;
  service: DirectMessageService;
  attachmentStorage?: ChatAttachmentIntegration;
  realtime?: DirectMessageRealtimePublisher;
  notifications?: NotificationService;
}>;

const uploadParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CHAT_ATTACHMENT_MAX_BYTES, files: CHAT_ATTACHMENT_MAX_FILES, fields: 1, fieldSize: 16_384, parts: CHAT_ATTACHMENT_MAX_FILES + 1 }
}).array("files", CHAT_ATTACHMENT_MAX_FILES);

const parseMessageAttachments: RequestHandler = (request, response, next) => {
  uploadParser(request, response, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: error.code === "LIMIT_FILE_SIZE" ? HTTP_STATUS.payloadTooLarge : HTTP_STATUS.badRequest,
        details: {
          field: "files",
          reason: error.code === "LIMIT_FILE_SIZE" ? "file_too_large" : "invalid_file_count_or_field"
        }
      }));
      return;
    }
    next(error);
  });
};

export const createDirectMessageRoutes = (dependencies: DirectMessageRouteDependencies): ExpressRouter => {
  const router = Router();
  const controllerDependencies = {
    ...dependencies,
    ...(dependencies.notifications ? { notifications: dependencies.notifications } : {})
  };
  router.get("/direct-messages", createListDirectMessagesController(controllerDependencies));
  router.post("/direct-messages", createOpenDirectMessageController(controllerDependencies));
  router.get("/direct-messages/:conversationId", createGetDirectMessageController(controllerDependencies));
  router.get(
    "/direct-messages/:conversationId/messages",
    createListDirectMessageHistoryController(controllerDependencies)
  );
  router.post(
    "/direct-messages/:conversationId/messages",
    createAuthorizeDirectMessageUploadController(controllerDependencies),
    parseMessageAttachments,
    createSendDirectMessageController(controllerDependencies)
  );
  router.delete(
    "/direct-messages/:conversationId/messages/:messageId",
    createDeleteDirectMessageController(controllerDependencies)
  );
  router.get(
    "/direct-messages/:conversationId/messages/:messageId/attachments/:attachmentId",
    createDownloadDirectMessageAttachmentController(controllerDependencies)
  );
  return router;
};
