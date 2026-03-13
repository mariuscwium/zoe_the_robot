import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "dist", ".claude"],
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts", "api/**/*.ts", "tools/**/*.ts", "twins/**/*.ts", "scripts/**/*.ts"],
      exclude: ["**/*.test.ts", "tests/**"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
    testTimeout: 10000,
  },
});
