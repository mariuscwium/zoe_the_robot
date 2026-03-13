import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { fetchMemoryContent } from "../lib/redis.js";

interface Props {
  memoryKeys: string[];
  isActive: boolean;
}

export function Memory({ memoryKeys, isActive }: Props): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [content, setContent] = useState<string>("");

  useInput((_input, key) => {
    if (!isActive) return;
    if (key.upArrow && selectedIndex > 0) setSelectedIndex(selectedIndex - 1);
    if (key.downArrow && selectedIndex < memoryKeys.length - 1) setSelectedIndex(selectedIndex + 1);
  }, { isActive });

  const selectedKey = memoryKeys[selectedIndex];

  useEffect(() => {
    if (!selectedKey) {
      setContent("");
      return;
    }
    let cancelled = false;
    void fetchMemoryContent(selectedKey).then((c) => {
      if (!cancelled) setContent(c);
    });
    return () => { cancelled = true; };
  }, [selectedKey]);

  return (
    <Box flexGrow={1} gap={1}>
      <Box flexDirection="column" width="30%">
        <Text bold color="white"> Memory Keys</Text>
        {memoryKeys.length === 0 && <Text color="gray"> No keys found</Text>}
        {memoryKeys.map((key, i) => (
          <Text key={key} color={i === selectedIndex ? "green" : "gray"}>
            {i === selectedIndex ? "▸ " : "  "}{key}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text bold color="white">{selectedKey ?? "No selection"}</Text>
        <Text>{content}</Text>
      </Box>
    </Box>
  );
}
