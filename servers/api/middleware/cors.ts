import type { RequestHandler } from "express";
import { HTTP_STATUS } from "../constants/index.js";

export const createCorsMiddleware = ({ origin }: { origin: string }): RequestHandler =>
  (request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-Workspace-Id");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    if (request.method === "OPTIONS") {
      response.sendStatus(HTTP_STATUS.noContent);
      return;
    }
    next();
  };
