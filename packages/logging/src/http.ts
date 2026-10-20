import type { IncomingMessage, ServerResponse } from "node:http";
import morgan from "morgan";
import type { Logger } from "./types.js";

type HttpLoggerOptions = Readonly<{
  logger: Logger;
  format?: "combined" | "common" | "dev" | "short" | "tiny";
  skip?: (request: IncomingMessage, response: ServerResponse) => boolean;
}>;

export const createHttpLogger = ({ logger, format = "combined", skip }: HttpLoggerOptions): ReturnType<typeof morgan> =>
  morgan(format, {
    ...(skip ? { skip } : {}),
    stream: {
      write: (line: string) => { logger.info("HTTP request", { http: line.trim() }); }
    }
  });
