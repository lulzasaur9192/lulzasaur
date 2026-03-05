import { useEffect } from "react";
import { AppProvider, useApp } from "./context/AppContext.js";
import { SSEProvider, useSSE } from "./context/SSEContext.js";
import { Layout } from "./components/Layout.js";
import type { SSEInboxCount } from "./types.js";

export function App() {
  return (
    <AppProvider>
      <SSEProvider>
        <SSEInboxBridge />
        <Layout />
      </SSEProvider>
    </AppProvider>
  );
}

/** Bridges SSE inbox_count events into AppContext */
function SSEInboxBridge() {
  const { setInboxCount } = useApp();
  const { subscribe } = useSSE();

  useEffect(() => {
    return subscribe("inbox_count", (data: SSEInboxCount) => {
      setInboxCount(data.pending);
    });
  }, [subscribe, setInboxCount]);

  return null;
}
