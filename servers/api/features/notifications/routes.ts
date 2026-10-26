import { Router } from "express";
import type { IncomingHttpHeaders } from "node:http";
import type { NotificationService } from "./service.js";
import { createNotificationControllers } from "./controller.js";

export const createNotificationRoutes = (dependencies: Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<Readonly<{
    id: string;
    name: string;
    email: string;
    image: string | null;
  }> | null>;
  service: NotificationService;
}>): Router => {
  const router = Router();
  const controllers = createNotificationControllers(dependencies);
  router.get("/notifications", controllers.list);
  router.get("/notifications/unread-count", controllers.unreadCount);
  router.patch("/notifications/read", controllers.markResourceRead);
  router.patch("/notifications/:notificationId/read", controllers.markRead);
  return router;
};
