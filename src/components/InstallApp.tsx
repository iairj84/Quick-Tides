import { useEffect, useState } from "react";
import { Download } from "lucide-react";

/**
 * Chrome fires `beforeinstallprompt` once the app meets the install criteria
 * (manifest, icons, service worker). Capturing it lets us offer the install in
 * the app's own chrome instead of hiding it in the browser menu. Nothing shows
 * in browsers that don't support it, or once the app is already installed.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Typed as `string` so TypeScript uses the generic event-listener overload:
// `beforeinstallprompt` is not in the DOM lib's WindowEventMap.
const PROMPT_EVENT: string = "beforeinstallprompt";

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's older flag; harmless elsewhere.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => isStandalone());

  useEffect(() => {
    const onPrompt = (event: Event) => {
      // Chrome would otherwise show its own mini-infobar.
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setHidden(true);
      setPrompt(null);
    };

    window.addEventListener(PROMPT_EVENT, onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener(PROMPT_EVENT, onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden || !prompt) return null;

  const handleClick = async () => {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    // A dismissed prompt can't be replayed; wait for a fresh event.
    if (choice.outcome !== "dismissed") setPrompt(null);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Install Quick Tides"
      title="Install Quick Tides on this device"
      className="inline-flex h-10 items-center gap-2 border border-border bg-foreground px-2.5 text-[11px] uppercase tracking-[0.12em] text-background transition-opacity hover:opacity-85 sm:h-auto sm:px-3 sm:py-1.5 sm:tracking-[0.14em]"
    >
      <Download className="size-4 sm:size-3.5" strokeWidth={1.5} />
      <span className="hidden sm:inline">Install</span>
    </button>
  );
}

export default InstallApp;
