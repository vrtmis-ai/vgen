"use client";

import Mcp from "../../../../src/screens/Mcp";
import { useNavigation } from "../../../../src/runtime/providers/NavigationProvider";

export default function McpPage() {
  const { openModel } = useNavigation();
  return <Mcp onOpenModel={openModel} />;
}
