import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "tests/unit.test.ts",
      "tests/password.test.ts",
      "tests/transport.test.ts",
    ],
  },
});
