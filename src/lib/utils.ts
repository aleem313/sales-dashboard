import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(dateString);
}

export function formatHours(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${hours.toFixed(1)}h`;
}

// Tiptap's `content` prop expects HTML. Job descriptions ingested via n8n are
// stored as plain text with `\n` newlines, which Tiptap collapses to spaces.
// Detect HTML and pass it through; otherwise escape plain text and convert
// double-newlines to paragraphs and single newlines to <br>.
export function descriptionToHtml(text: string | null | undefined): string {
  if (!text) return "";
  if (/^\s*<(p|br|div|h\d|ul|ol|li|span|strong|em|a)\b/i.test(text)) {
    return text;
  }
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// Copy text to clipboard with a fallback for insecure (HTTP) contexts
// where `navigator.clipboard` is unavailable — e.g. the self-hosted Contabo
// deployment at http://157.173.110.62.
export async function copyText(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand fallback
  }
  // execCommand fallback. We must mount the temporary <textarea> INSIDE the
  // currently focused element's subtree — otherwise Radix Dialog's FocusScope
  // will intercept the focus handoff and bounce focus back into the dialog,
  // killing the selection before `execCommand("copy")` can read it. Symptom:
  // execCommand returns true but nothing actually lands on the clipboard.
  try {
    const activeEl = (document.activeElement as HTMLElement | null) ?? null;
    const host = activeEl?.parentElement ?? document.body;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    host.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    host.removeChild(textarea);
    if (activeEl && typeof activeEl.focus === "function") {
      activeEl.focus({ preventScroll: true });
    }
    return ok;
  } catch {
    return false;
  }
}
