export const HTTP_STATUS = Object.freeze({
  ok: 200,
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  conflict: 409,
  payloadTooLarge: 413,
  tooManyRequests: 429,
  created: 201,
  serviceUnavailable: 503,
  notFound: 404,
  internalServerError: 500
} as const);
