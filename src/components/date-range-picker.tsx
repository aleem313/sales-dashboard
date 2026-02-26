"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

const presets = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "12M", days: 365 },
];

export function DateRangePicker() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const currentRange = searchParams.get("range") || "30";

  function handleSelect(days: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", String(days));
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      {presets.map((preset) => (
        <Button
          key={preset.label}
          variant={currentRange === String(preset.days) ? "default" : "outline"}
          size="sm"
          onClick={() => handleSelect(preset.days)}
        >
          {preset.label}
        </Button>
      ))}
    </div>
  );
}
