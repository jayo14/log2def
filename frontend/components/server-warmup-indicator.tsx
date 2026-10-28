"use client";

import { useEffect, useState } from "react";

export function ServerWarmupIndicator() {
  const [status, setStatus] = useState<"idle" | "warming" | "ready" | "hidden">("idle");

  useEffect(() => {
    let isMounted = true;

    // Only show "warming up" if the server is in cold sleep (takes > 1.5s to respond)
    const thresholdTimer = setTimeout(() => {
      if (isMounted) {
        setStatus((prev) => (prev === "idle" ? "warming" : prev));
      }
    }, 1500);

    const checkServerHealth = async () => {
      try {
        const res = await fetch("/health", {
          method: "GET",
          cache: "no-store",
        });

        if (res.ok && isMounted) {
          clearTimeout(thresholdTimer);
          setStatus((prev) => {
            if (prev === "warming") {
              // Transition smoothly to "warmed up", then hide after 2.5s
              setTimeout(() => {
                if (isMounted) setStatus("hidden");
              }, 2500);
              return "ready";
            }
            // Backend was already awake; keep UI clean without flashing
            return "hidden";
          });
        }
      } catch {
        // Fallback retry after 3s if server is still spinning up
        if (isMounted) {
          setTimeout(async () => {
            if (!isMounted) return;
            try {
              const retryRes = await fetch("/health", { method: "GET", cache: "no-store" });
              if (retryRes.ok && isMounted) {
                setStatus("ready");
                setTimeout(() => {
                  if (isMounted) setStatus("hidden");
                }, 2500);
              }
            } catch {
              // Gracefully hide after 30s max if unreachable
              setTimeout(() => {
                if (isMounted) setStatus("hidden");
              }, 30000);
            }
          }, 3000);
        }
      }
    };

    checkServerHealth();

    return () => {
      isMounted = false;
      clearTimeout(thresholdTimer);
    };
  }, []);

  if (status === "idle" || status === "hidden") return null;

  return (
    <aside
      aria-label="Server status"
      className="fixed bottom-4 right-4 z-50 pointer-events-none select-none transition-all duration-500 ease-out animate-in fade-in slide-in-from-bottom-2"
    >
      <div className="flex items-center gap-2 rounded-full border border-stone-200/70 bg-white/90 px-3 py-1.5 text-xs text-stone-600 shadow-sm backdrop-blur-md">
        {status === "warming" ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500"></span>
            </span>
            <span className="tracking-tight text-stone-600 font-normal">warming up...</span>
          </>
        ) : (
          <>
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            <span className="tracking-tight text-emerald-700 font-normal">warmed up</span>
          </>
        )}
      </div>
    </aside>
  );
}
