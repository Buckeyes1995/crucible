"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, Loader2, Sparkles, Trash2, X as XIcon, Dice5 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";

type GalleryImage = { filename: string; subfolder: string; size: number; mtime: number };

const SIZES: Array<{ label: string; w: number; h: number }> = [
  { label: "1024² square", w: 1024, h: 1024 },
  { label: "1152×896 landscape", w: 1152, h: 896 },
  { label: "896×1152 portrait", w: 896, h: 1152 },
  { label: "1216×832 wide", w: 1216, h: 832 },
  { label: "832×1216 tall", w: 832, h: 1216 },
];

const DEFAULT_NEGATIVE =
  "blurry, low quality, deformed, extra fingers, malformed hands, watermark, text, signature, cropped";

function fileUrl(img: { filename: string; subfolder?: string }) {
  const qs = img.subfolder ? `?subfolder=${encodeURIComponent(img.subfolder)}` : "";
  return `/api/images/file/${encodeURIComponent(img.filename)}${qs}`;
}

export default function ImagesPage() {
  const [up, setUp] = useState<boolean | null>(null);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [samplers, setSamplers] = useState<string[]>([]);

  const [checkpoint, setCheckpoint] = useState("");
  const [positive, setPositive] = useState("");
  const [negative, setNegative] = useState(DEFAULT_NEGATIVE);
  const [size, setSize] = useState(SIZES[0]);
  const [steps, setSteps] = useState(25);
  const [cfg, setCfg] = useState(6.5);
  const [sampler, setSampler] = useState("dpmpp_2m");
  const [scheduler, setScheduler] = useState("karras");
  const [seed, setSeed] = useState(0);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ value: number; max: number } | null>(null);
  const [latest, setLatest] = useState<GalleryImage | null>(null);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadGallery = useCallback(async () => {
    try {
      const r = await fetch("/api/images/gallery?limit=120");
      const d = await r.json();
      setGallery(d.images || []);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await (await fetch("/api/images/status")).json();
        setUp(!!s.up);
        if (!s.up) return;
        const c = await (await fetch("/api/images/checkpoints")).json();
        setCheckpoints(c.checkpoints || []);
        if (c.checkpoints?.[0]) setCheckpoint(c.checkpoints[0]);
        const sm = await (await fetch("/api/images/samplers")).json();
        setSamplers(sm.samplers || []);
      } catch {
        setUp(false);
      }
      loadGallery();
    })();
  }, [loadGallery]);

  const generate = async () => {
    if (!checkpoint || !positive.trim() || busy) return;
    setBusy(true);
    setProgress(null);
    setLatest(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    const usedSeed = seed === 0 ? Math.floor(Math.random() * 2 ** 31) : seed;
    try {
      const r = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpoint, positive, negative,
          width: size.w, height: size.h,
          steps, cfg, sampler, scheduler, seed: usedSeed,
        }),
        signal: ctl.signal,
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of chunk.split("\n")) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            try {
              const evt = JSON.parse(t.slice(5).trim());
              if (evt.event === "progress") {
                setProgress({ value: evt.value, max: evt.max });
              } else if (evt.event === "done") {
                const img = evt.images?.[0];
                if (img) setLatest({ ...img, size: 0, mtime: Date.now() / 1000 });
                toast("Generated", "success");
              } else if (evt.event === "error") {
                toast(evt.error || "generation error", "error");
              }
            } catch {}
          }
        }
      }
      await loadGallery();
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast(`Generate failed: ${(e as Error).message}`, "error");
      }
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const remove = async (img: GalleryImage) => {
    const qs = img.subfolder ? `?subfolder=${encodeURIComponent(img.subfolder)}` : "";
    try {
      await fetch(`/api/images/file/${encodeURIComponent(img.filename)}${qs}`, { method: "DELETE" });
      setGallery(g => g.filter(x => x.filename !== img.filename));
      if (latest?.filename === img.filename) setLatest(null);
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "error");
    }
  };

  if (up === false) {
    return (
      <div className="space-y-6">
        <PageHeader icon={<ImageIcon className="w-5 h-5" />} title="Images" description="Local image generation via ComfyUI" />
        <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-200">
          ComfyUI daemon not reachable on <code className="font-mono text-amber-100">http://localhost:8188</code>.
          Start it with <code className="font-mono text-amber-100">launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jim.comfyui.plist</code>.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<ImageIcon className="w-5 h-5" />}
        title="Images"
        description="Local txt2img via ComfyUI · RealVisXL on MPS"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Left: prompt + preview */}
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur p-4 space-y-3">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Prompt</label>
            <textarea
              value={positive}
              onChange={e => setPositive(e.target.value)}
              placeholder="A cinematic photo of…"
              rows={4}
              className="w-full rounded-lg bg-zinc-950/60 border border-white/[0.08] px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 resize-y font-mono"
            />
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Negative</label>
            <textarea
              value={negative}
              onChange={e => setNegative(e.target.value)}
              rows={2}
              className="w-full rounded-lg bg-zinc-950/60 border border-white/[0.08] px-3 py-2 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 resize-y font-mono"
            />
            <div className="flex items-center gap-2 pt-1">
              <Button variant="primary" size="md" onClick={generate} disabled={busy || !positive.trim() || !checkpoint}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {busy ? "Generating…" : "Generate"}
              </Button>
              {busy && <Button variant="ghost" size="md" onClick={cancel}>Cancel</Button>}
              {progress && (
                <div className="flex-1 ml-2">
                  <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all"
                      style={{ width: `${(progress.value / progress.max) * 100}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1 font-mono">step {progress.value}/{progress.max}</div>
                </div>
              )}
            </div>
          </div>

          {latest && (
            <div className="rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur p-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 mb-2">Latest</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={fileUrl(latest)}
                alt={latest.filename}
                className="w-full rounded-lg cursor-pointer"
                onClick={() => setLightbox(latest)}
              />
            </div>
          )}
        </div>

        {/* Right: settings */}
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur p-4 space-y-3 h-fit">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Checkpoint</label>
            <select
              value={checkpoint}
              onChange={e => setCheckpoint(e.target.value)}
              className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            >
              {checkpoints.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Size</label>
            <select
              value={`${size.w}x${size.h}`}
              onChange={e => {
                const [w, h] = e.target.value.split("x").map(Number);
                setSize(SIZES.find(s => s.w === w && s.h === h) ?? SIZES[0]);
              }}
              className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            >
              {SIZES.map(s => <option key={`${s.w}x${s.h}`} value={`${s.w}x${s.h}`}>{s.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Steps</label>
              <input
                type="number" min={1} max={150}
                value={steps}
                onChange={e => setSteps(Math.max(1, Math.min(150, +e.target.value || 1)))}
                className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">CFG</label>
              <input
                type="number" min={1} max={30} step={0.5}
                value={cfg}
                onChange={e => setCfg(+e.target.value || 1)}
                className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-indigo-500/50"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Sampler</label>
            <select
              value={sampler}
              onChange={e => setSampler(e.target.value)}
              className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            >
              {samplers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Scheduler</label>
            <select
              value={scheduler}
              onChange={e => setScheduler(e.target.value)}
              className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            >
              {["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform"].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Seed (0 = random)</label>
            <div className="mt-1 flex gap-1">
              <input
                type="number" min={0}
                value={seed}
                onChange={e => setSeed(Math.max(0, +e.target.value || 0))}
                className="flex-1 rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-indigo-500/50"
              />
              <Button variant="ghost" size="sm" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))} title="Random seed">
                <Dice5 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Gallery */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Gallery · {gallery.length}</div>
        {gallery.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-zinc-500">
            No images yet — generate one above.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {gallery.map(img => (
              <div key={img.filename} className="group relative rounded-lg overflow-hidden border border-white/10 bg-zinc-900/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(img)}
                  alt={img.filename}
                  loading="lazy"
                  className="w-full aspect-square object-cover cursor-pointer transition-transform group-hover:scale-[1.02]"
                  onClick={() => setLightbox(img)}
                />
                <button
                  onClick={() => remove(img)}
                  className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/60 backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity text-zinc-300 hover:text-red-400"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur flex items-center justify-center p-6"
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300"
          >
            <XIcon className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={fileUrl(lightbox)}
            alt={lightbox.filename}
            className={cn("max-w-full max-h-full rounded-lg shadow-2xl", "object-contain")}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
