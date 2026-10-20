import type { IncomingHttpHeaders } from "node:http";
import { Router } from "express";
import {
  createGetDirectMessageController,
  createListDirectMessageHistoryController,
  createListDirectMessagesController,
  createOpenDirectMessageController,
  createSendDirectMessageController
} from "../controllers/index.js";
import type { DirectMessageService } from "../services/index.js";
import type { DirectMessageRealtimePublisher } from "../realtime/index.js";

type DirectMessageIdentity = Readonly<{ id: string; name: string; email: string; image: string | null }>;
type DirectWorkspaceAccessResult =
  | Readonly<{ kind: "unauthenticated" }>
  | Readonly<{ kind: "denied" }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{ kind: "allowed"; access: Readonly<{ workspace: Readonly<{ id: string }> }> }>;

export type DirectMessageRouteDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<DirectMessageIdentity | null>;
  getWorkspaceAccess: (
    identity: DirectMessageIdentity | null,
    workspaceId: string | null
  ) => Promise<DirectWorkspaceAccessResult>;
  service: DirectMessageService;
  realtime?: DirectMessageRealtimePublisher;
}>;

export const createDirectMessageRoutes = (dependencies: DirectMessageRouteDependencies) => {
  const router = Router();
  router.get("/direct-messages", createListDirectMessagesController(dependencies));
  router.post("/direct-messages", createOpenDirectMessageController(dependencies));
  router.get("/direct-messages/:conversationId", createGetDirectMessageController(dependencies));
  router.get(
    "/direct-messages/:conversationId/messages",
    createListDirectMessageHistoryController(dependencies)
  );
  router.post(
    "/direct-messages/:conversationId/messages",
    createSendDirectMessageController(dependencies)
  );
  return router;
};
