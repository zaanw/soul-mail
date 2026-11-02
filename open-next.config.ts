import { defineCloudflareConfig } from "@opennextjs/cloudflare";
// Mail and account endpoints must never use shared incremental caches.
export default defineCloudflareConfig();
