import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const path = window.location.pathname;

async function boot() {
  const root = createRoot(document.getElementById("root")!);

  if (path.startsWith("/paris")) {
    const { ParisPage } = await import("./pages/ParisPage");
    root.render(
      <StrictMode>
        <ParisPage />
      </StrictMode>
    );
  } else {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>
    );
  }
}

boot();
