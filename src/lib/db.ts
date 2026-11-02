import { AsyncLocalStorage } from "node:async_hooks";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const scope = new AsyncLocalStorage<PrismaClient>();
const globalDb = globalThis as unknown as { db?: PrismaClient };
function nodeClient() {
  return (globalDb.db ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  }));
}
// Resolve on each operation; Workers sockets and pools belong to one request.
export const db = new Proxy({} as PrismaClient, {
  get(_target, key) {
    const client = scope.getStore() || nodeClient();
    const value = Reflect.get(client, key);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
export async function withDatabase<T>(fn: () => Promise<T>): Promise<T> {
  let cf: import("@opennextjs/cloudflare").CloudflareContext | undefined;
  try {
    cf = getCloudflareContext();
  } catch {
    return fn();
  }
  const binding = cf.env as CloudflareEnv & {
    HYPERDRIVE?: { connectionString: string };
    DATABASE_URL?: string;
  };
  const url = binding.HYPERDRIVE?.connectionString || binding.DATABASE_URL;
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
  const client = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 10000,
    }),
  }) as unknown as PrismaClient;
  return scope.run(client, async () => {
    try {
      return await fn();
    } finally {
      cf!.ctx.waitUntil(client.$disconnect());
    }
  });
}
