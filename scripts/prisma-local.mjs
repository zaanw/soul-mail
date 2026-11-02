// Pinned official Prisma WASM APIs: no native schema-engine download required.
import "dotenv/config";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { getGenerators } = require("@prisma/internals");
const { PrismaClientJsGenerator } = require("@prisma/client-generator-js");
const { Pool } = require("pg");
const { PrismaPg } = require("@prisma/adapter-pg");
const {
  bindMigrationAwareSqlAdapterFactory,
} = require("@prisma/driver-adapter-utils");
const action = process.argv[2];
const schemaPath = resolve("prisma/schema.prisma");
if (action === "generate") {
  const generators = await getGenerators({
    schemaPath,
    registry: {
      "prisma-client-js": {
        type: "in-process",
        generator: new PrismaClientJsGenerator({ cliCommand: "prisma" }),
      },
    },
    cliCommand: "prisma",
    skipDownload: true,
  });
  try {
    for (const g of generators) await g.generate();
  } finally {
    for (const g of generators) g.stop();
  }
  console.log(
    "Prisma Node/Workers client generated with official WASM tooling.",
  );
} else if (action === "migrate" || action === "initial-sql") {
  const schema = await readFile(schemaPath, "utf8");
  const runtime = await import("@prisma/schema-engine-wasm/schema_engine_bg");
  const wasmPath = resolve(
    require.resolve("@prisma/schema-engine-wasm/schema_engine_bg"),
    "../schema_engine_bg.wasm",
  );
  const module = new WebAssembly.Module(await readFile(wasmPath));
  const instance = new WebAssembly.Instance(module, {
    "./schema_engine_bg.js": runtime,
  });
  runtime.__wbg_set_wasm(instance.exports);
  instance.exports.__wbindgen_start();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const engine = await runtime.SchemaEngine.new(
    { datamodels: [[schemaPath, schema]] },
    () => {},
    bindMigrationAwareSqlAdapterFactory(new PrismaPg(pool)),
  );
  const filters = { externalTables: [], externalEnums: [] };
  try {
    if (action === "initial-sql") {
      const path = "prisma/migrations/20261102000000_init";
      const diff = await engine.diff({
        from: { tag: "empty" },
        to: {
          tag: "schemaDatamodel",
          files: [{ path: schemaPath, content: schema }],
        },
        script: true,
        exitCode: null,
        filters,
      });
      await mkdir(path, { recursive: true });
      await writeFile(`${path}/migration.sql`, diff.stdout, { flag: "wx" });
      await writeFile(
        "prisma/migrations/migration_lock.toml",
        'provider = "postgresql"\n',
      );
      console.log("Initial SQL generated from Prisma schema.");
    } else {
      const baseDir = resolve("prisma/migrations");
      const dirs = (await readdir(baseDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name));
      const migrationsList = {
        baseDir,
        lockfile: {
          path: "migration_lock.toml",
          content: await readFile(`${baseDir}/migration_lock.toml`, "utf8"),
        },
        shadowDbInitScript: "",
        migrationDirectories: await Promise.all(
          dirs.map(async (d) => ({
            path: d.name,
            migrationFile: {
              path: "migration.sql",
              content: {
                tag: "ok",
                value: await readFile(
                  `${baseDir}/${d.name}/migration.sql`,
                  "utf8",
                ),
              },
            },
          })),
        ),
      };
      const result = await engine.applyMigrations({ migrationsList, filters });
      console.log("Applied migrations:", result.appliedMigrationNames);
    }
  } finally {
    engine.free();
    await pool.end();
  }
} else
  throw new Error(
    "Usage: node scripts/prisma-local.mjs generate|migrate|initial-sql",
  );
