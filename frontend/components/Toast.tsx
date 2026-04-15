"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Check, X, AlertTriangle, Info, Loader2 } from "lucide-react";

export type ToastType = "success" | "error" | "info" | "loading";

type Toast = {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
  exiting: boolean;
};

let _id = 0;
let _addToast: ((message: string, type: ToastType, duration?: number) => number) | null = null;
let _removeToast: ((id: number) => void) | null = null;
let _updateToast: ((id: number, message: string, type: ToastType) => void) | null = null;

export function toast(message: string, type: ToastType = "success", duration = 3000) {
  return _addToast?.(message, type, duration) ?? 0;
}

export function toastDismiss(id: number) {
  _removeToast?.(id);
}

export function toastUpdate(id: number, message: string, type: ToastType) {
  _updateToast?.(id, message, type);
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <Check className="w-4 h-4 text-emerald-400" />,
  error: <X className="w-4 h-4 text-red-400" />,
  info: <Info className="w-4 h-4 text-indigo-400" />,
  loading: <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />,
};

const BORDERS: Record<ToastType, string> = {
  success: "border-emerald-500/20",
  error: "border-red-500/20",
  info: "border-indigo-500/20",
  loading: "border-indigo-500/20",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300);
  }, []);

  const add = useCallback((message: string, type: ToastType, duration = 3000) => {
    const id = ++_id;
    setToasts((prev) => [...prev.slice(-4), { id, message, type, duration, exiting: false }]);
    if (type !== "loading" && duration > 0) {
      setTimeout(() => remove(id), duration);
    }
    return id;
  }, [remove]);

  const update = useCallback((id: number, message: string, type: ToastType) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, message, type } : t));
    if (type !== "loading") {
      setTimeout(() => remove(id), 3000);
    }
  }, [remove]);

  useEffect(() => {
    _addToast = add;
    _removeToast = remove;
    _updateToast = update;
    return () => { _addToast = null; _removeToast = null; _updateToast = null; };
  }, [add, remove, update]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl",
            "bg-zinc-900/95 backdrop-blur-xl border shadow-lg shadow-black/20",
            "transition-all duration-300 ease-out",
            BORDERS[t.type],
            t.exiting ? "opacity-0 translate-x-4 scale-95" : "opacity-100 translate-x-0 scale-100",
            "animate-slide-in"
          )}
        >
          {ICONS[t.type]}
          <span className="text-sm text-zinc-200">{t.message}</span>
          {t.type !== "loading" && (
            <button onClick={() => remove(t.id)} className="ml-2 text-zinc-600 hover:text-zinc-400 transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
