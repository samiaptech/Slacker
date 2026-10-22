import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import type { Logger } from "@workspace/logging";
import type { ApiErrorResponse } from "@workspace/types";
import { ERROR_CODES, ERROR_MESSAGES, HTTP_STATUS } from "../constants/index.js";
import { createApplicationError, isApplicationError } from "../errors/index.js";

type MongoValidationDiagnostic = Readonly<{
  code?: number;
  codeName?: string;
  validationRules?: readonly string[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const summarizeMongoValidationError = (error: unknown): MongoValidationDiagnostic => {
  if (!isRecord(error)) return Object.freeze({});
  const code = typeof error.code === "number" ? error.code : undefined;
  const codeName = typeof error.codeName === "string" ? error.codeName : undefined;
  const errInfo = isRecord(error.errInfo) ? error.errInfo : null;
  const validationDetails = errInfo && isRecord(errInfo.details) ? errInfo.details : null;
  const schemaRules = validationDetails?.schemaRulesNotSatisfied;
  if (!schemaRules || (code !== 121 && codeName !== "DocumentValidationFailure")) {
    return Object.freeze({
      ...(code !== undefined ? { code } : {}),
      ...(codeName ? { codeName } : {})
    });
  }

  const validationRules: string[] = [];
  const visit = (value: unknown, path: string, depth: number): void => {
    if (validationRules.length >= 25 || depth >= 20) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, path, depth + 1);
      return;
    }
    if (!isRecord(value)) return;

    const currentPath = typeof value.propertyName === "string"
      ? path ? `${path}.${value.propertyName}` : value.propertyName
      : path;
    if (typeof value.operatorName === "string" && currentPath) {
      validationRules.push(`${currentPath}:${value.operatorName}`);
    }
    for (const key of ["details", "schemaRulesNotSatisfied", "propertiesNotSatisfied", "itemsNotSatisfied"]) {
      if (key in value) visit(value[key], currentPath, depth + 1);
    }
  };
  visit(schemaRules, "", 0);

  return Object.freeze({
    ...(code !== undefined ? { code } : {}),
    ...(codeName ? { codeName } : {}),
    ...(validationRules.length > 0 ? { validationRules: Object.freeze(validationRules) } : {})
  });
};

export const createNotFoundHandler = (): RequestHandler => (request, _response, next) => {
  next(createApplicationError({
    code: ERROR_CODES.routeNotFound,
    message: ERROR_MESSAGES.routeNotFound,
    status: HTTP_STATUS.notFound,
    details: { method: request.method, path: request.path }
  }));
};

export const createErrorHandler = ({ logger }: { logger: Logger }): ErrorRequestHandler =>
  (error: unknown, _request, response, _next) => {
    if (error instanceof ZodError) {
      const body: ApiErrorResponse = {
        error: { code: ERROR_CODES.validation, message: ERROR_MESSAGES.validation, details: error.issues }
      };
      response.status(HTTP_STATUS.badRequest).json(body);
      return;
    }
    if (isApplicationError(error)) {
      const body: ApiErrorResponse = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {})
        }
      };
      response.status(error.status).json(body);
      return;
    }
    logger.error("Unhandled API error.", {
      error: error instanceof Error ? error.message : String(error),
      ...summarizeMongoValidationError(error)
    });
    const body: ApiErrorResponse = {
      error: { code: ERROR_CODES.internal, message: ERROR_MESSAGES.internal }
    };
    response.status(HTTP_STATUS.internalServerError).json(body);
  };
