import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
if (!existsSync(".env")) {
  const password = randomBytes(24).toString("hex");
  writeFileSync(
    ".env",
    `DATABASE_URL=postgresql://soul:${password}@localhost:5432/soul\nAPP_URL=http://localhost:3000\nMAIL_DOMAIN=localhost\nINBOUND_TOKEN=${randomBytes(32).toString("hex")}\n`,
    { mode: 0o600, flag: "wx" },
  );
}
const { parse } = await import("dotenv");
const vars = parse(readFileSync(".env"));
const url = new URL(vars.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error(
    "dev-db only starts a local development database. Use your configured PostgreSQL service instead.",
  );
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
Object.assign(env, {
  POSTGRES_USER: decodeURIComponent(url.username),
  POSTGRES_PASSWORD: decodeURIComponent(url.password),
  POSTGRES_DB: url.pathname.slice(1),
});
function docker(args, capture = false) {
  const r = spawnSync(
    "docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    { env, encoding: "utf8", stdio: capture ? "pipe" : "inherit" },
  );
  if (r.error) throw r.error;
  return r;
}
if (docker(["info", "--format", "{{.ServerVersion}}"], true).status !== 0)
  throw new Error("Local Docker daemon unavailable.");
const name = "soul-postgres";
const inspect = docker(
  ["inspect", "--format", "{{.State.Running}}", name],
  true,
);
if (inspect.status !== 0) {
  const r = docker([
    "run",
    "-d",
    "--name",
    name,
    "--restart",
    "unless-stopped",
    "-p",
    `127.0.0.1:${url.port || 5432}:5432`,
    "-e",
    "POSTGRES_USER",
    "-e",
    "POSTGRES_PASSWORD",
    "-e",
    "POSTGRES_DB",
    "-v",
    "soul-postgres-data:/var/lib/postgresql/data",
    "postgres:17-bookworm",
  ]);
  if (r.status !== 0) process.exit(r.status || 1);
} else if (inspect.stdout.trim() !== "true") {
  const r = docker(["start", name]);
  if (r.status !== 0) process.exit(r.status || 1);
}
let ready = false;
for (let i = 0; i < 40; i++) {
  if (
    docker(
      [
        "exec",
        name,
        "pg_isready",
        "-U",
        env.POSTGRES_USER,
        "-d",
        env.POSTGRES_DB,
      ],
      true,
    ).status === 0
  ) {
    ready = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) throw new Error("PostgreSQL did not become ready.");
console.log(
  "Development PostgreSQL is ready. Credentials remain in ignored .env.",
);
