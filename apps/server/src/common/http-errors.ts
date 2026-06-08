import { BadRequestException } from "@nestjs/common";
import { ZodError, ZodSchema } from "zod";

export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException(error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
    }
    throw error;
  }
}
