import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest, getAuth, handleApiError } from "../services/api.js";
import type { SMSCredits } from "../types.js";

export function registerSmsTools(server: McpServer): void {

  // ─── Check SMS Credits ────────────────────────────────────────────
  server.registerTool(
    "blanxer_check_sms_credits",
    {
      title: "Check SMS Credits",
      description: `Check current SMS credit balance for your Blanxer store.

Returns total credits, used credits, and remaining balance.
Always check credits before sending bulk SMS to ensure sufficient balance.`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const { storeId } = getAuth();
        const data = await apiRequest<SMSCredits>(`sms/${storeId}`);
        return {
          content: [{
            type: "text",
            text: `# SMS Credits\n- **Total**: ${data.credits}\n- **Used**: ${data.used}\n- **Remaining**: ${data.remaining}`,
          }]
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );

  // ─── Send Bulk SMS ────────────────────────────────────────────────
  server.registerTool(
    "blanxer_send_bulk_sms",
    {
      title: "Send Bulk SMS",
      description: `Send an SMS to multiple customers at once.

Args:
  - message (string): SMS message text. Keep under 160 chars for 1 credit per number. Each extra 153 chars costs 1 additional credit per number.
  - numbers (string[]): Array of phone numbers to send to (e.g. ['9841234567', '9851234567'])

Important: Check blanxer_check_sms_credits first to ensure sufficient balance.
Returns confirmation.`,
      inputSchema: z.object({
        message: z.string().min(1).max(480)
          .describe("SMS message text (under 160 chars = 1 credit per number)"),
        numbers: z.array(z.string().regex(/^\d{10}$/, "Phone must be 10 digits"))
          .min(1).max(1000)
          .describe("Array of 10-digit phone numbers"),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      try {
        const { storeId } = getAuth();
        const segments = Math.ceil(params.message.length / 160);
        const estimatedCost = params.numbers.length * segments;

        await apiRequest<unknown>(`sms/send_bulk_sms_number/${storeId}`, "POST", {
          message: params.message,
          numbers: params.numbers,
        });

        return {
          content: [{
            type: "text",
            text: `SMS sent successfully!\n- **Recipients**: ${params.numbers.length}\n- **Message length**: ${params.message.length} chars (${segments} segment${segments > 1 ? "s" : ""})\n- **Estimated credits used**: ~${estimatedCost}`,
          }]
        };
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: handleApiError(err) }] };
      }
    }
  );
}
