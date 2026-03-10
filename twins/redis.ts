/**
 * Digital twin: stateful in-memory behavioral clone of the Upstash Redis REST API.
 * Implements the RedisClient interface from lib/deps.ts.
 */

import type { Clock, RedisClient, RedisResult } from "../lib/deps.js";
import type { StoreEntry } from "./redis-types.js";
import { err } from "./redis-types.js";
import {
  handleGet,
  handleSet,
  handleAppend,
  handleMget,
  handleMset,
  handleIncr,
  handleIncrby,
} from "./redis-strings.js";
import {
  handleLpush,
  handleRpush,
  handleLpop,
  handleRpop,
  handleLrange,
  handleLtrim,
  handleLlen,
} from "./redis-lists.js";
import {
  handleDel,
  handleExists,
  handleKeys,
  handleScan,
  handleExpire,
  handleTtl,
  handlePttl,
  handlePersist,
} from "./redis-keys.js";

type Handler = (
  args: string[],
  store: Map<string, StoreEntry>,
  nowMs: number,
) => RedisResult;

const COMMAND_MAP: Record<string, Handler> = {
  GET: handleGet,
  SET: handleSet,
  DEL: handleDel,
  EXISTS: handleExists,
  KEYS: handleKeys,
  SCAN: handleScan,
  EXPIRE: handleExpire,
  TTL: handleTtl,
  PTTL: handlePttl,
  PERSIST: handlePersist,
  LPUSH: handleLpush,
  RPUSH: handleRpush,
  LPOP: handleLpop,
  RPOP: handleRpop,
  LRANGE: handleLrange,
  LTRIM: handleLtrim,
  LLEN: handleLlen,
  APPEND: handleAppend,
  MGET: handleMget,
  MSET: handleMset,
  INCR: handleIncr,
  INCRBY: handleIncrby,
};

export class RedisTwin implements RedisClient {
  private readonly store = new Map<string, StoreEntry>();
  private virtualNowMs: number;

  constructor(private readonly clock: Clock) {
    this.virtualNowMs = clock.now().getTime();
  }

  /** Advance virtual clock by ms, expiring keys lazily on next access. */
  tick(ms: number): void {
    this.virtualNowMs += ms;
  }

  /** Reset all state for test isolation. */
  reset(): void {
    this.store.clear();
    this.virtualNowMs = this.clock.now().getTime();
  }

  /** Get current virtual time in milliseconds. */
  get nowMs(): number {
    return this.virtualNowMs;
  }

  async execute(command: string[]): Promise<RedisResult> {
    return Promise.resolve(this.executeSync(command));
  }

  async pipeline(commands: string[][]): Promise<RedisResult[]> {
    return Promise.resolve(commands.map((cmd) => this.executeSync(cmd)));
  }

  private executeSync(command: string[]): RedisResult {
    const name = command[0]?.toUpperCase();
    if (name === undefined) {
      return err("ERR empty command");
    }
    const handler = COMMAND_MAP[name];
    if (handler === undefined) {
      return err(`ERR unknown command '${command[0] ?? ""}'`);
    }
    return handler(command.slice(1), this.store, this.virtualNowMs);
  }
}
