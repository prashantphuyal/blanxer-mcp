import { z } from "zod";
import { ResponseFormat } from "../constants.js";

export const ResponseFormatSchema = z.object({
  response_format: z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN)
    .describe("Output format: 'markdown' for human-readable, 'json' for machine-readable"),
});
