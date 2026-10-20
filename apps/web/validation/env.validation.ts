import { z } from "zod";
import type { ValidatedWebEnvironment } from "@/types";

export const webEnvironmentSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.url()
}) satisfies z.ZodType<ValidatedWebEnvironment>;

export const validateWebEnvironment = (input: unknown): ValidatedWebEnvironment =>
  Object.freeze(webEnvironmentSchema.parse(input));
