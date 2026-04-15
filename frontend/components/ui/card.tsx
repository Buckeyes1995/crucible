import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  variant?: "default" | "glass" | "outline" | "glow";
}) {
  const variants = {
    default: "rounded-2xl border border-white/[0.06] bg-zinc-900/40",
    glass: "rounded-2xl border border-white/[0.06] bg-zinc-900/40 backdrop-blur-xl",
    outline: "rounded-2xl border border-white/[0.08] bg-transparent",
    glow: "rounded-2xl border border-indigo-500/20 bg-zinc-900/40 glow-indigo",
  };

  return (
    <div
      className={cn(variants[variant], "transition-all duration-200", className)}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-5 pt-5 pb-0", className)}>{children}</div>;
}

export function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("text-sm font-semibold text-zinc-100 tracking-tight", className)}>{children}</h3>;
}

export function CardDescription({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs text-zinc-500 mt-1", className)}>{children}</p>;
}
