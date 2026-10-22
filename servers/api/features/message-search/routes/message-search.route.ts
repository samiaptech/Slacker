import { Router, type Router as ExpressRouter } from "express";
import {
  createMessageSearchController,
  type MessageSearchControllerDependencies
} from "../controllers/index.js";

export const createMessageSearchRoutes = (dependencies: MessageSearchControllerDependencies): ExpressRouter => {
  const router = Router();
  router.post("/messages/search", createMessageSearchController(dependencies));
  return router;
};
