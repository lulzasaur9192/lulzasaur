import { AppProvider } from "./context/AppContext.js";
import { SSEProvider } from "./context/SSEContext.js";
import { Layout } from "./components/Layout.js";

export function App() {
  return (
    <AppProvider>
      <SSEProvider>
        <Layout />
      </SSEProvider>
    </AppProvider>
  );
}
