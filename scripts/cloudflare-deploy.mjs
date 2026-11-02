import { parse as parseJsonc } from "jsonc-parser";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { config as dotenv } from "dotenv";
import { resolve } from "node:path";
if (process.argv.includes("--help")) {
  console.log(
    "Configure private .env.cloudflare from .env.cloudflare.example, then npm run build:cloudflare && npm run deploy:cloudflare. Use --dry-run to validate/upload nothing. This command never creates or migrates a database.",
  );
  process.exit(0);
}
dotenv({ path: ".env.cloudflare", quiet: true });
const dry = process.argv.includes("--dry-run");
const required = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CF_HYPERDRIVE_ID",
  "CF_APP_URL",
  "CF_MAIL_DOMAIN",
  ...(!dry ? ["CLOUDFLARE_API_TOKEN"] : []),
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length)
  throw new Error(
    `Missing deployment settings: ${missing.join(", ")}. Use environment settings or ignored .env.cloudflare, never chat.`,
  );
if (
  !/^[a-f\d]{32}$/i.test(process.env.CLOUDFLARE_ACCOUNT_ID) ||
  !/^[a-f\d]{32}$/i.test(process.env.CF_HYPERDRIVE_ID)
)
  throw new Error(
    "Cloudflare account and Hyperdrive IDs must be 32 hexadecimal characters.",
  );
const origin = new URL(process.env.CF_APP_URL);
if (
  origin.protocol !== "https:" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
)
  throw new Error("APP_URL must be the exact public HTTPS origin.");
if (
  !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(
    process.env.CF_MAIL_DOMAIN,
  )
)
  throw new Error("MAIL_DOMAIN must be a real domain, not localhost.");
if (!existsSync(".open-next/worker.js"))
  throw new Error("Run npm run build:cloudflare first.");
// Hyperdrive query caching must be off: stale sessions or mailbox reads are unsafe.
if (!dry) {
  const result = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/hyperdrive/configs/${process.env.CF_HYPERDRIVE_ID}`,
    {
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!result.ok)
    throw new Error(
      `Cloudflare Hyperdrive preflight failed (${result.status}); verify account-scoped token access.`,
    );
  const payload = await result.json();
  if (!payload.success || payload.result?.caching?.disabled !== true)
    throw new Error(
      "Disable Hyperdrive query caching before deploying mail/session storage. No Worker has been published.",
    );
}
const config = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
const name = process.env.CF_WORKER_NAME || config.name;
if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name))
  throw new Error("Invalid Worker name.");
config.name = name;
config.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
config.main = resolve(".open-next/worker.js");
config.assets.directory = resolve(".open-next/assets");
config.services = [{ binding: "WORKER_SELF_REFERENCE", service: name }];
config.hyperdrive = [
  { binding: "HYPERDRIVE", id: process.env.CF_HYPERDRIVE_ID },
];
const names = [
  "MAIL_FROM",
  "SMTP_FROM",
  "REQUIRE_EMAIL_VERIFICATION",
  "ADMIN_EMAILS",
  "MAIL_MX_HOST",
  "MAIL_SPF",
  "MAIL_DKIM_SELECTOR",
  "MAIL_DKIM_VALUE",
  "MAIL_DMARC",
];
config.vars = Object.fromEntries(
  names.filter((k) => process.env[k]).map((k) => [k, process.env[k]]),
);
config.vars.APP_URL = process.env.CF_APP_URL;
config.vars.MAIL_DOMAIN = process.env.CF_MAIL_DOMAIN;
mkdirSync(".local", { recursive: true });
const file = ".local/wrangler.deploy.json";
writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
async function wrangler(args, input) {
  await new Promise((accept, reject) => {
    const p = spawn("npx", ["--no-install", "wrangler", ...args], {
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      stdio: [input ? "pipe" : "inherit", "inherit", "inherit"],
    });
    if (input) p.stdin.end(input);
    p.on("error", reject);
    p.on("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`Wrangler exited with status ${code}`)),
    );
  });
}
await wrangler([
  "deploy",
  "--config",
  file,
  ...(dry ? ["--dry-run", "--outdir", ".local/cloudflare-dry-run"] : []),
]);
if (!dry) {
  const secrets = Object.fromEntries(
    ["RESEND_API_KEY", "INBOUND_TOKEN"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  if (Object.keys(secrets).length)
    await wrangler(
      ["secret", "bulk", "--config", file],
      JSON.stringify(secrets),
    );
  console.log(
    "Deployment commands completed. Verify the live /api/health endpoint and register only after PostgreSQL migrations are confirmed.",
  );
}
