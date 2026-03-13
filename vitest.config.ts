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
      exclude: [
        "**/*.test.ts", "tests/**",
        "lib/prod-deps.ts", "lib/notion-client.ts", "lib/oauth.ts",
        "lib/clients.ts", "lib/deps.ts", "lib/types.ts",
        "api/google.ts", "api/callback.ts",
        "scripts/**",
      ],
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 88,
        lines: 85,
      },
    },
    testTimeout: 10000,
  },
});
