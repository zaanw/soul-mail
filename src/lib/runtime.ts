import { getCloudflareContext } from "@opennextjs/cloudflare";
export function isCloudflare() {
  try {
    getCloudflareContext();
    return true;
  } catch {
    return false;
  }
}
export function serverMetrics() {
  let uptime: number | null = null,
    memoryMB: number | null = null;
  try {
    uptime = Math.floor(process.uptime());
  } catch {}
  try {
    memoryMB = Math.round(process.memoryUsage().rss / 1048576);
  } catch {}
  return { uptime, memoryMB, database: "connected" };
}
