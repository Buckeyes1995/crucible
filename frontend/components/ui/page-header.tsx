import { cn } from "@/lib/utils";

export function PageHeader({
  icon,
  title,
  description,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between", className)}>
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-zinc-800/50 text-indigo-400">
          {icon}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-100 tracking-tight">{title}</h1>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
