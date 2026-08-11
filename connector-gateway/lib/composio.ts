import "server-only";
import { Composio } from "@composio/core";

export function createComposioClient(apiKey: string, allowTracking = false) {
  return new Composio({ apiKey, allowTracking });
}
