import { describe, it, expect } from "vitest";
import handler from "./health.js";

function createMockRes(): {
  res: { status: (code: number) => { json: (body: unknown) => void } };
  getStatus: () => number;
  getBody: () => unknown;
} {
  let statusCode = 0;
  let body: unknown = null;

  const res = {
    status(code: number) {
      statusCode = code;
      return {
        json(b: unknown) {
          body = b;
        },
      };
    },
  };

  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

describe("api/health", () => {
  it("returns 200 with status ok", () => {
    const { res, getStatus, getBody } = createMockRes();

    handler(
      {} as Parameters<typeof handler>[0],
      res as unknown as Parameters<typeof handler>[1],
    );

    expect(getStatus()).toBe(200);

    const body = getBody() as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns a valid ISO timestamp", () => {
    const { res, getBody } = createMockRes();

    handler(
      {} as Parameters<typeof handler>[0],
      res as unknown as Parameters<typeof handler>[1],
    );

    const body = getBody() as { timestamp: string };
    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });
});
