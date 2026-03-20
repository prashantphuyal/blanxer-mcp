import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Stateless MCP transport for Cloudflare Workers.
 * Each HTTP request is a single MCP message → single response round-trip.
 */
export class WorkersHttpTransport implements Transport {
  private _responseResolve?: (msg: JSONRPCMessage) => void;
  private _responseReject?: (err: Error) => void;

  onmessage?: (message: JSONRPCMessage) => void;
  onerror?: (error: Error) => void;
  onclose?: () => void;

  async start(): Promise<void> {
    // No persistent connection needed for stateless HTTP
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this._responseResolve?.(message);
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  /**
   * Process a single MCP JSON-RPC request and return the response.
   */
  async handleMessage(body: unknown): Promise<JSONRPCMessage> {
    return new Promise((resolve, reject) => {
      this._responseResolve = resolve;
      this._responseReject = reject;

      try {
        this.onmessage?.(body as JSONRPCMessage);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
