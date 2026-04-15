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

    if (typeof Notification === "undefined") return;
    const perm = Notification.permission;
    if (perm === "granted" || perm === "denied") return;

    if (localStorage.getItem(DISMISS_KEY) === "1") return;

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
