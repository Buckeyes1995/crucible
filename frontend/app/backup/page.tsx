"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Archive, Download, Upload, RefreshCw } from "lucide-react";

type BackupFile = { name: string; size: number };

export default function BackupPage() {
  const [files, setFiles] = useState<BackupFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = () => fetch("/api/backup/files").then(r => r.json()).then(setFiles);
  useEffect(() => { load(); }, []);

  const exportBackup = () => { window.open("/api/backup/export", "_blank"); };

  const importBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setResult(null);
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/backup/import", { method: "POST", body: form });
    const data = await r.json();
    setResult(`Restored ${data.files?.length ?? 0} files: ${data.files?.join(", ")}`);
    setImporting(false); load();
  };

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Archive className="w-6 h-6 text-indigo-400" />
        <h1 className="text-xl font-semibold text-zinc-100">Backup & Restore</h1>
        <span className="text-xs text-zinc-500">{(totalSize / 1e6).toFixed(1)} MB total</span>
      </div>

      <div className="flex gap-3">
        <Button onClick={exportBackup} variant="primary" className="gap-1.5"><Download className="w-4 h-4" /> Export Backup</Button>
        <label className="inline-flex">
          <input type="file" accept=".zip" className="hidden" onChange={importBackup} disabled={importing} />
          <Button variant="ghost" className="gap-1.5" onClick={() => document.querySelector<HTMLInputElement>('input[type=file]')?.click()}>
            <Upload className="w-4 h-4" /> Import Backup
          </Button>
        </label>
      </div>

      {result && <div className="px-3 py-2 rounded bg-emerald-900/30 border border-emerald-500/30 text-emerald-300 text-sm">{result}</div>}

      <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-white/[0.04] text-zinc-500 text-xs uppercase tracking-wider">
            <th className="px-4 py-3 text-left">File</th><th className="px-4 py-3 text-right">Size</th>
          </tr></thead>
          <tbody>
            {files.map(f => (
              <tr key={f.name} className="border-b border-white/[0.04]">
                <td className="px-4 py-2.5 text-zinc-300 font-mono text-xs">{f.name}</td>
                <td className="px-4 py-2.5 text-right text-zinc-500 font-mono text-xs">{(f.size / 1e3).toFixed(1)} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
