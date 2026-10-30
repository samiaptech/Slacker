import type { RequestHandler } from "express";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../../../constants/index.js";
import { createApplicationError } from "../../../errors/index.js";
import type { ProfileImageService } from "../services/profile-image.service.js";

const validationError = (
  reason: string,
  status: typeof HTTP_STATUS.badRequest | typeof HTTP_STATUS.payloadTooLarge = HTTP_STATUS.badRequest
) =>
  createApplicationError({
    code: ERROR_CODES.validation,
    message: ERROR_MESSAGES.validation,
    status,
    details: { field: "file", reason }
  });

export const createUpdateProfileImageController = (
  service: ProfileImageService
): RequestHandler => async (request, response, next): Promise<void> => {
  const file = request.file;
  if (!file) {
    next(validationError("missing_file"));
    return;
  }

  try {
    const result = await service.update(request.headers, {
      buffer: file.buffer,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size
    });
    if (result.kind === "invalid") {
      next(validationError(
        result.reason,
        result.reason === "file_too_large" ? HTTP_STATUS.payloadTooLarge : HTTP_STATUS.badRequest
      ));
      return;
    }
    if (result.kind === "storage-unavailable") {
      next(createApplicationError({
        code: ERROR_CODES.profileImageStorageUnavailable,
        message: ERROR_MESSAGES.profileImageStorageUnavailable,
        status: HTTP_STATUS.serviceUnavailable
      }));
      return;
    }
    if (result.kind === "update-failed") {
      next(createApplicationError({
        code: ERROR_CODES.profileImageUpdateFailed,
        message: ERROR_MESSAGES.profileImageUpdateFailed,
        status: HTTP_STATUS.internalServerError
      }));
      return;
    }

    response.status(HTTP_STATUS.ok).json({ image: result.image });
  } catch (error: unknown) {
    next(error);
  }
};
