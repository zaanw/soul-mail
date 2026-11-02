import { parse as parseJsonc } from "jsonc-parser";
// Dedicated local PostgreSQL fixtures. Never resets the application's database.
import "dotenv/config";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const original = new URL(process.env.DATABASE_URL || "");
if (
  !["localhost", "127.0.0.1"].includes(original.hostname) ||
  original.pathname !== "/soul" ||
  original.username !== "soul"
)
  throw new Error(
    "Cloudflare E2E requires the known local soul development database; remote targets are refused.",
  );
const name = `soul_cf_test_${randomBytes(6).toString("hex")}`;
const pool = new Pool({ connectionString: original.toString() });
try {
  await pool.query(`CREATE DATABASE "${name}"`);
} finally {
  await pool.end();
}
const testUrl = new URL(original);
testUrl.pathname = `/${name}`;
const inbound = randomBytes(32).toString("hex");
const base = "http://localhost:8788";
const directory = ".local/cloudflare-e2e";
mkdirSync(directory, { recursive: true });
const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
config.name = "soul-mail-e2e";
config.main = resolve(".open-next/worker.js");
config.assets.directory = resolve(".open-next/assets");
config.services = [
  { binding: "WORKER_SELF_REFERENCE", service: "soul-mail-e2e" },
];
writeFileSync(`${directory}/wrangler.json`, JSON.stringify(config, null, 2), {
  mode: 0o600,
});
writeFileSync(
  `${directory}/.dev.vars`,
  `APP_URL=${JSON.stringify(base)}\nMAIL_DOMAIN="localhost"\nDATABASE_URL=${JSON.stringify(testUrl.toString())}\nINBOUND_TOKEN=${JSON.stringify(inbound)}\n`,
  { mode: 0o600 },
);
const env = {
  ...process.env,
  DATABASE_URL: testUrl.toString(),
  INBOUND_TOKEN: inbound,
  TEST_BASE_URL: base,
  WRANGLER_SEND_METRICS: "false",
};
async function run(command, args) {
  await new Promise((ok, bad) => {
    const p = spawn(command, args, { env, stdio: "inherit" });
    p.on("error", bad);
    p.on("exit", (code) =>
      code === 0 ? ok() : bad(new Error(`${command} exited ${code}`)),
    );
  });
}
await run("node", ["scripts/prisma-local.mjs", "migrate"]);
const preview = spawn(
  "npx",
  [
    "--no-install",
    "wrangler",
    "dev",
    "--config",
    `${directory}/wrangler.json`,
    "--port",
    "8788",
  ],
  { env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: "inherit" },
);
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (preview.exitCode !== null) throw new Error("Worker preview exited.");
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ready) throw new Error("Worker health did not become ready.");
  await run("npx", ["--no-install", "playwright", "test"]);
} finally {
  preview.kill("SIGTERM");
}
console.log(
  `Cloudflare E2E completed on local fixture database ${name}. Retained for diagnosis; no production data was used.`,
);
