"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unlockAudio } from "@/lib/notification-sound";

const DISMISS_KEY = "notif-banner-dismissed";

export function NotificationPermissionBanner() {
  const [show, setShow] = useState(false);
  const [secureContext, setSecureContext] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSecureContext(window.isSecureContext);

    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    // On a secure context the Notification API is available — if the user has
    // already granted or denied, there's nothing left to prompt for.
    if (typeof Notification !== "undefined") {
      const perm = Notification.permission;
      if (perm === "granted" || perm === "denied") return;
    }

    // Otherwise show the banner. Either to request notification permission
    // (secure/HTTPS context) OR, on an insecure/HTTP origin where the
    // Notification API is unavailable, to let the agent unlock in-page audio
    // with a click so the beep works. (Desktop notifications still need HTTPS.)
    setShow(true);
  }, []);

  async function handleEnable() {
    unlockAudio();
    try {
      if (typeof Notification !== "undefined" && window.isSecureContext) {
        await Notification.requestPermission();
      }
    } catch {
      // no-op
    }
    // Persist so we don't re-nag every reload; audio also re-unlocks on any
    // later page interaction, and on HTTPS the granted/denied check suppresses it.
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // no-op
    }
    setShow(false);
  }

  function handleDismiss() {
    unlockAudio();
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // no-op
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b bg-primary/5 px-4 py-2 text-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Bell className="h-4 w-4 shrink-0" />
        <span>
          {secureContext
            ? "Enable desktop notifications to get alerted the moment a new task lands."
            : "Desktop notifications require HTTPS. Click Enable to turn on in-page sound only."}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="default" onClick={handleEnable} className="h-7 text-xs">
          Enable
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDismiss} className="h-7 w-7 p-0">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
