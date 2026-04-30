"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Loader2, Sparkles, Trash2, X as XIcon, Dice5 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/Toast";
import { cn } from "@/lib/utils";

type GalleryClip = { filename: string; subfolder: string; size: number; mtime: number };

const SIZES: Array<{ label: string; w: number; h: number }> = [
  { label: "768×512 landscape", w: 768, h: 512 },
  { label: "512×768 portrait", w: 512, h: 768 },
  { label: "640×640 square", w: 640, h: 640 },
  { label: "1024×576 wide", w: 1024, h: 576 },
];

const LENGTHS: Array<{ label: string; frames: number }> = [
  { label: "~2s · 49 frames", frames: 49 },
  { label: "~3s · 73 frames", frames: 73 },
  { label: "~4s · 97 frames", frames: 97 },
  { label: "~5s · 121 frames", frames: 121 },
  { label: "~6s · 145 frames", frames: 145 },
];

const DEFAULT_NEGATIVE =
  "blurry, low quality, deformed, extra fingers, malformed hands, watermark, text, signature, jittery, glitching";

function fileUrl(c: { filename: string; subfolder?: string }) {
  const qs = c.subfolder ? `?subfolder=${encodeURIComponent(c.subfolder)}` : "";
  return `/api/videos/file/${encodeURIComponent(c.filename)}${qs}`;
}

export default function VideosPage() {
  const [up, setUp] = useState<boolean | null>(null);
  const [checkpoints, setCheckpoints] = useState<string[]>([]);
  const [textEncoders, setTextEncoders] = useState<string[]>([]);

  const [checkpoint, setCheckpoint] = useState("");
  const [textEncoder, setTextEncoder] = useState("");
  const [positive, setPositive] = useState("");
  const [negative, setNegative] = useState(DEFAULT_NEGATIVE);
  const [size, setSize] = useState(SIZES[0]);
  const [length, setLength] = useState(LENGTHS[2]);
  const [frameRate, setFrameRate] = useState(24);
  const [steps, setSteps] = useState(8);
  const [cfg, setCfg] = useState(1.0);
  const [seed, setSeed] = useState(0);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ value: number; max: number } | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [latest, setLatest] = useState<GalleryClip | null>(null);
  const [gallery, setGallery] = useState<GalleryClip[]>([]);
  const [lightbox, setLightbox] = useState<GalleryClip | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadGallery = useCallback(async () => {
    try {
      const r = await fetch("/api/videos/gallery?limit=120");
      const d = await r.json();
      setGallery(d.videos || []);
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await (await fetch("/api/videos/status")).json();
        setUp(!!s.up);
        if (!s.up) return;
        const c = await (await fetch("/api/videos/checkpoints")).json();
        const all: string[] = c.checkpoints || [];
        const ltx = all.filter(n => /ltx/i.test(n));
        setCheckpoints(ltx.length ? ltx : all);
        if (ltx[0]) setCheckpoint(ltx[0]);
        const te = await (await fetch("/api/videos/text_encoders")).json();
        const allTE: string[] = te.text_encoders || [];
        const t5 = allTE.filter(n => /t5/i.test(n));
        setTextEncoders(t5.length ? t5 : allTE);
        if (t5[0]) setTextEncoder(t5[0]);
      } catch {
        setUp(false);
      }
      loadGallery();
    })();
  }, [loadGallery]);

  const generate = async () => {
    if (!checkpoint || !textEncoder || !positive.trim() || busy) return;
    setBusy(true);
    setProgress(null);
    setStage("Loading model");
    setLatest(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    const usedSeed = seed === 0 ? Math.floor(Math.random() * 2 ** 31) : seed;
    try {
      const r = await fetch("/api/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpoint, text_encoder: textEncoder,
          positive, negative,
          width: size.w, height: size.h,
          length: length.frames, frame_rate: frameRate,
          steps, cfg, sampler: "euler", seed: usedSeed,
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
                setStage("Sampling");
              } else if (evt.event === "stage") {
                const map: Record<string, string> = {
                  CheckpointLoaderSimple: "Loading model",
                  CLIPLoader: "Loading text encoder",
                  CLIPTextEncode: "Encoding prompt",
                  EmptyLTXVLatentVideo: "Preparing latent",
                  LTXVConditioning: "Conditioning",
                  ModelSamplingLTXV: "Configuring sampler",
                  LTXVScheduler: "Building schedule",
                  KSamplerSelect: "Selecting sampler",
                  SamplerCustom: "Sampling",
                  VAEDecode: "Decoding video",
                  SaveAnimatedWEBP: "Encoding webp",
                };
                setStage(map[evt.class] || evt.class || `node ${evt.node}`);
              } else if (evt.event === "done") {
                const clip = evt.videos?.[0];
                if (clip) setLatest({ ...clip, size: 0, mtime: Date.now() / 1000 });
                toast("Video generated", "success");
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
      setStage(null);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const remove = async (c: GalleryClip) => {
    const qs = c.subfolder ? `?subfolder=${encodeURIComponent(c.subfolder)}` : "";
    try {
      await fetch(`/api/videos/file/${encodeURIComponent(c.filename)}${qs}`, { method: "DELETE" });
      setGallery(g => g.filter(x => x.filename !== c.filename));
      if (latest?.filename === c.filename) setLatest(null);
    } catch (e) {
      toast(`Delete failed: ${(e as Error).message}`, "error");
    }
  };

  if (up === false) {
    return (
      <div className="space-y-6">
        <PageHeader icon={<Film className="w-5 h-5" />} title="Videos" description="Local video generation via ComfyUI" />
        <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-sm text-amber-200">
          ComfyUI daemon not reachable on <code className="font-mono text-amber-100">http://localhost:8188</code>.
          Start it with <code className="font-mono text-amber-100">comfy-start</code>.
        </div>
      </div>
    );
  }

  const noModels = up && checkpoints.length === 0;
  const noTE = up && textEncoders.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Film className="w-5 h-5" />}
        title="Videos"
        description="Local txt2vid via ComfyUI · LTX-Video on MPS"
      />

      {(noModels || noTE) && (
        <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-xs text-amber-200">
          {noModels && <div>No video checkpoints found in <code>/Volumes/DataNVME/models/comfy/checkpoints</code> matching <code>ltx*</code>.</div>}
          {noTE && <div>No text encoders found in <code>/Volumes/DataNVME/models/comfy/text_encoders</code> matching <code>t5*</code>.</div>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Left: prompt + preview */}
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur p-4 space-y-3">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Prompt</label>
            <textarea
              value={positive}
              onChange={e => setPositive(e.target.value)}
              placeholder="A cinematic clip of…"
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
              <Button variant="primary" size="md" onClick={generate} disabled={busy || !positive.trim() || !checkpoint || !textEncoder}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {busy ? "Generating…" : "Generate"}
              </Button>
              {busy && <Button variant="ghost" size="md" onClick={cancel}>Cancel</Button>}
              {(progress || stage) && (
                <div className="flex-1 ml-2">
                  <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all",
                        progress && progress.value < progress.max ? "bg-indigo-500" : "bg-indigo-400 animate-pulse"
                      )}
                      style={{ width: progress ? `${(progress.value / progress.max) * 100}%` : "100%" }}
                    />
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-1 font-mono">
                    {progress && progress.value < progress.max
                      ? `${stage ?? "sampling"} · step ${progress.value}/${progress.max}`
                      : stage ?? "working"}
                  </div>
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
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Text encoder (T5)</label>
            <select
              value={textEncoder}
              onChange={e => setTextEncoder(e.target.value)}
              className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            >
              {textEncoders.map(c => <option key={c} value={c}>{c}</option>)}
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
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Length</label>
            <select
              value={length.frames}
              onChange={e => setLength(LENGTHS.find(l => l.frames === +e.target.value) ?? LENGTHS[2])}
              className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500/50"
            >
              {LENGTHS.map(l => <option key={l.frames} value={l.frames}>{l.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">FPS</label>
              <input
                type="number" min={8} max={60}
                value={frameRate}
                onChange={e => setFrameRate(Math.max(8, Math.min(60, +e.target.value || 24)))}
                className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Steps</label>
              <input
                type="number" min={1} max={50}
                value={steps}
                onChange={e => setSteps(Math.max(1, Math.min(50, +e.target.value || 8)))}
                className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-indigo-500/50"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">CFG</label>
              <input
                type="number" min={0.5} max={10} step={0.1}
                value={cfg}
                onChange={e => setCfg(+e.target.value || 1.0)}
                className="mt-1 w-full rounded-md bg-zinc-950/60 border border-white/[0.08] px-2 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-indigo-500/50"
              />
            </div>
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
          <div className="text-[10px] text-zinc-500 leading-relaxed pt-1">
            LTX distilled defaults: 8 steps · CFG 1.0 · euler. Higher steps don&apos;t help distilled models.
          </div>
        </div>
      </div>

      {/* Gallery */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Gallery · {gallery.length}</div>
        {gallery.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-zinc-500">
            No clips yet — generate one above.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {gallery.map(c => (
              <div key={c.filename} className="group relative rounded-lg overflow-hidden border border-white/10 bg-zinc-900/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(c)}
                  alt={c.filename}
                  loading="lazy"
                  className="w-full aspect-video object-cover cursor-pointer transition-transform group-hover:scale-[1.02]"
                  onClick={() => setLightbox(c)}
                />
                <button
                  onClick={() => remove(c)}
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
            className="max-w-full max-h-full rounded-lg shadow-2xl object-contain"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
