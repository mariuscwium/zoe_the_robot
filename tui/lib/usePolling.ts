import { useState, useEffect, useCallback } from "react";
import type { DashboardData } from "./types.js";
import { fetchUnifiedLogs, fetchMemoryKeys, fetchTokenLog, testConnection } from "./redis.js";

const POLL_INTERVAL = 3000;

const EMPTY: DashboardData = {
  logs: [],
  memoryKeys: [],
  tokenLog: [],
  connected: false,
  lastPoll: "",
};

export function usePolling(): DashboardData {
  const [data, setData] = useState<DashboardData>(EMPTY);

  const poll = useCallback(async () => {
    try {
      const [logs, memoryKeys, tokenLog, connected] = await Promise.all([
        fetchUnifiedLogs(100),
        fetchMemoryKeys(),
        fetchTokenLog(100),
        testConnection(),
      ]);
      setData({ logs, memoryKeys, tokenLog, connected, lastPoll: new Date().toISOString() });
    } catch {
      setData((prev) => ({ ...prev, connected: false }));
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll]);

  return data;
}
