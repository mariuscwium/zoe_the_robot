import React, { useState } from "react";
import { render, Box, useInput, useApp } from "ink";
import { config } from "dotenv";
import { initRedis } from "./lib/redis.js";
import { usePolling } from "./lib/usePolling.js";
import { Logs } from "./components/Logs.js";
import { Memory } from "./components/Memory.js";
import { Agents } from "./components/Agents.js";
import { Tokens } from "./components/Tokens.js";
import { StatusBar } from "./components/StatusBar.js";

config({ path: ".env" });

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  process.stderr.write("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in .env\n");
  process.exit(1);
}
initRedis(url, token);

function Dashboard(): React.ReactElement {
  const [tab, setTab] = useState(0);
  const data = usePolling();
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === "q") exit();
    if (input === "1") setTab(0);
    if (input === "2") setTab(1);
    if (input === "3") setTab(2);
    if (input === "4") setTab(3);
    if (key.tab) setTab((t) => (t + 1) % 4);
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1}>
        {tab === 0 && <Logs logs={data.logs} />}
        {tab === 1 && <Memory memoryKeys={data.memoryKeys} isActive={tab === 1} />}
        {tab === 2 && <Agents logs={data.logs} />}
        {tab === 3 && <Tokens tokenLog={data.tokenLog} />}
      </Box>
      <StatusBar activeTab={tab} connected={data.connected} lastPoll={data.lastPoll} />
    </Box>
  );
}

render(<Dashboard />);
