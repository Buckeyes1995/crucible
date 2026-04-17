import { cn } from "@/lib/utils";

export function Tooltip({
  label,
  children,
  side = "bottom",
  className,
}: {
  label: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  return (
    <span className={cn("relative group/tt min-w-0 inline-block", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-0 z-50 whitespace-nowrap max-w-[90vw]",
          "rounded-md border border-white/10 bg-zinc-900/95 px-2 py-1 text-xs font-mono text-zinc-100 shadow-lg",
          "opacity-0 group-hover/tt:opacity-100 transition-opacity duration-100",
          side === "top" ? "bottom-full mb-1" : "top-full mt-1",
        )}
      >
        {label}
      </span>
    </span>
  );
}
