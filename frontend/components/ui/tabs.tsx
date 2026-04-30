"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

// Top-level Root - just re-export.
export const Tabs = TabsPrimitive.Root;

// Horizontal tab bar styled to match the existing dark glass UI.
export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 rounded-xl border border-white/[0.06] bg-zinc-900/50 p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium",
      "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50",
      "data-[state=active]:bg-indigo-500/15 data-[state=active]:text-indigo-200",
      "data-[state=active]:shadow-[inset_0_0_0_1px_rgba(99,102,241,0.2)]",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
