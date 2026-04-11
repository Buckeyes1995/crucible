import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  const gb = bytes / 1_073_741_824;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1_048_576;
  return `${mb.toFixed(0)} MB`;
}

export function formatTps(tps: number | null | undefined): string {
  if (tps == null) return "—";
  return `${tps.toFixed(1)} tok/s`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(0)}ms`;
}

export function formatContext(ctx: number | null | undefined): string {
  if (!ctx) return "—";
  if (ctx >= 1000) return `${(ctx / 1000).toFixed(0)}k`;
  return String(ctx);
}
