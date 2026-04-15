import { cn } from "@/lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16 px-4", className)}>
      <div className="p-4 rounded-2xl bg-zinc-800/30 text-zinc-700 mb-4">
        {icon}
      </div>
      <h3 className="text-base font-medium text-zinc-400 mb-1">{title}</h3>
      {description && <p className="text-sm text-zinc-600 mb-4 max-w-sm text-center">{description}</p>}
      {action}
    </div>
  );
}
