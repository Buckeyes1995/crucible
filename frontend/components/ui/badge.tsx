import { cn } from "@/lib/utils";

type BadgeProps = {
  children: React.ReactNode;
  variant?: "mlx" | "gguf" | "ollama" | "mlx_studio" | "active" | "muted";
  className?: string;
};

export function Badge({ children, variant = "muted", className }: BadgeProps) {
  const variants = {
    mlx: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
    gguf: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    ollama: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    mlx_studio: "bg-violet-500/20 text-violet-300 border-violet-500/30",
    active: "bg-green-500/20 text-green-300 border-green-500/30",
    muted: "bg-zinc-800 text-zinc-400 border-zinc-700",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
