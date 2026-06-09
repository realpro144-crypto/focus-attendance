import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { startApp } from "./app.js";

function App() {
  const appRef = useRef(null);

  useEffect(() => {
    if (!appRef.current) return undefined;
    return startApp(appRef.current);
  }, []);

  return <div ref={appRef} className="app-shell" aria-live="polite" />;
}

createRoot(document.querySelector("#root")).render(<App />);
