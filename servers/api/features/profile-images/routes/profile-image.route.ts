import type { IncomingHttpHeaders } from "node:http";
import { Router, type RequestHandler } from "express";
import multer from "multer";
import type { AuthenticationIdentity } from "../../../integrations/authentication/index.js";
import { createApplicationError } from "../../../errors/index.js";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import type { ProfileImageStorage } from "../../../integrations/cloudinary/index.js";
import { PROFILE_IMAGE_MAX_BYTES } from "../validation/profile-image.validation.js";
import { createProfileImageService } from "../services/profile-image.service.js";
import { createUpdateProfileImageController } from "../controllers/profile-image.controller.js";

export type ProfileImageRouteDependencies = Readonly<{
  getIdentity: (headers: IncomingHttpHeaders) => Promise<AuthenticationIdentity | null>;
  updateUserImage: (headers: IncomingHttpHeaders, image: string) => Promise<void>;
  storage?: ProfileImageStorage;
}>;

const uploadParser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: PROFILE_IMAGE_MAX_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
    fieldNameSize: 64
  }
}).single("file");

const cacheControl: RequestHandler = (_request, response, next): void => {
  response.setHeader("Cache-Control", "no-store");
  next();
};

const parseMultipart: RequestHandler = (request, response, next): void => {
  uploadParser(request, response, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      next(createApplicationError({
        code: ERROR_CODES.validation,
        message: ERROR_MESSAGES.validation,
        status: tooLarge ? HTTP_STATUS.payloadTooLarge : HTTP_STATUS.badRequest,
        details: { field: "file", reason: tooLarge ? "file_too_large" : "invalid_file_count_or_field" }
      }));
      return;
    }
    next(error);
  });
};

export const createProfileImageRoutes = ({
  getIdentity,
  updateUserImage,
  storage
}: ProfileImageRouteDependencies): Router => {
  const router = Router();
  const service = createProfileImageService({
    updateUserImage,
    ...(storage ? { storage } : {})
  });
  const updateController = createUpdateProfileImageController(service);
  const authenticate: RequestHandler = async (request, response, next): Promise<void> => {
    try {
      const identity = await getIdentity(request.headers);
      if (!identity) {
        next(createApplicationError({
          code: ERROR_CODES.unauthenticated,
          message: ERROR_MESSAGES.unauthenticated,
          status: HTTP_STATUS.unauthorized
        }));
        return;
      }
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
  router.post("/profile/image", cacheControl, authenticate, parseMultipart, updateController);
  return router;
};
