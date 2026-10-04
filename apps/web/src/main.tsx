import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setActiveEditorPlatform } from "@tikz-editor/app/platform/current";
import { createBrowserPlatformAdapter } from "./platform/browser-platform";

async function bootstrap() {
  setActiveEditorPlatform(createBrowserPlatformAdapter());
  const { TikzBench } = await import("./TikzBench");

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <TikzBench />
    </StrictMode>
  );
}

void bootstrap();
