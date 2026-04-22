"use client";

// Deterministic, per-item SVG thumbnail for the store.
//
// Goals:
//   - every item gets a distinctive key-art thumbnail, no external assets
//   - same id → same art (deterministic hash)
//   - same kind (model/prompt/…) shares visual language (glyph + palette family)
//   - larger size tier → bolder pattern

import { useEffect, useMemo, useState } from "react";

// One-time manifest load: /public/store-art/manifest.json lists slugs that
// have a hand-designed asset (e.g. ["models-qwen3_6-35B", …]). Absent
// manifest → everyone gets the generated SVG. Keeps us from firing 404s
// for every card on every page load.
type Manifest = { slugs: string[] };
let _manifest: Set<string> | null = null;
let _manifestPromise: Promise<Set<string>> | null = null;

function loadManifest(): Promise<Set<string>> {
  if (_manifest) return Promise.resolve(_manifest);
  if (_manifestPromise) return _manifestPromise;
  _manifestPromise = fetch("/store-art/manifest.json", { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : { slugs: [] } as Manifest))
    .catch(() => ({ slugs: [] } as Manifest))
    .then((m) => {
      _manifest = new Set(m.slugs || []);
      return _manifest;
    });
  return _manifestPromise;
}

type Kind = "models" | "prompts" | "workflows" | "system_prompts" | "mcps";

// Cheap non-crypto hash; we only need ~32 bits of spread.
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// HSL triple → hex string
function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

// Kind-specific palette bases (hue anchor per kind so an MCP never looks
// like a model). Each kind gets a 30-degree hue band.
const KIND_HUE: Record<Kind, number> = {
  models: 235,          // indigo
  prompts: 280,         // violet
  workflows: 190,       // cyan
  system_prompts: 25,   // amber
  mcps: 150,            // emerald
};

// Per-kind glyph. Each returns SVG fragments (path/rect/polygon) centered at
// (0,0) on an 80×80 viewport; the caller translates + scales as needed.
function glyphFor(kind: Kind, color: string, accent: string): React.ReactNode {
  switch (kind) {
    case "models": // chip with pins
      return (
        <g stroke={color} strokeWidth={4} fill="none" strokeLinecap="round">
          <rect x={-22} y={-22} width={44} height={44} rx={6} fill={color} fillOpacity={0.12} />
          <rect x={-12} y={-12} width={24} height={24} rx={2} stroke={accent} />
          {[-14, 14].map((x, i) => (
            <g key={i}>
              <line x1={x} y1={-22} x2={x} y2={-28} />
              <line x1={x} y1={22} x2={x} y2={28} />
              <line x1={-22} y1={x} x2={-28} y2={x} />
              <line x1={22} y1={x} x2={28} y2={x} />
            </g>
          ))}
        </g>
      );
    case "prompts": // quill
      return (
        <g stroke={color} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M -18 22 L 16 -18 C 20 -22 26 -18 22 -14 L -16 22 Z" fill={color} fillOpacity={0.18} />
          <path d="M -6 16 L 12 -2" stroke={accent} strokeWidth={2.5} />
          <path d="M -22 26 L -10 22 L -6 30 Z" fill={accent} stroke="none" />
        </g>
      );
    case "workflows": // chained nodes / DAG
      return (
        <g stroke={color} strokeWidth={3} fill={color} fillOpacity={0.22}>
          <circle cx={-22} cy={-10} r={7} />
          <circle cx={6} cy={-18} r={7} />
          <circle cx={18} cy={14} r={7} />
          <circle cx={-10} cy={20} r={7} stroke={accent} />
          <line x1={-18} y1={-10} x2={2} y2={-16} stroke={accent} strokeWidth={2.5} />
          <line x1={10} y1={-14} x2={16} y2={8} stroke={accent} strokeWidth={2.5} />
          <line x1={13} y1={18} x2={-5} y2={20} stroke={accent} strokeWidth={2.5} />
          <line x1={-12} y1={14} x2={-20} y2={-4} stroke={accent} strokeWidth={2.5} />
        </g>
      );
    case "system_prompts": // shield
      return (
        <g stroke={color} strokeWidth={3} fill={color} fillOpacity={0.18} strokeLinejoin="round">
          <path d="M 0 -26 L 22 -16 L 22 4 C 22 16 12 24 0 28 C -12 24 -22 16 -22 4 L -22 -16 Z" />
          <path d="M -10 -2 L -3 6 L 12 -10" stroke={accent} strokeWidth={3} fill="none" strokeLinecap="round" />
        </g>
      );
    case "mcps": // plug
      return (
        <g stroke={color} strokeWidth={3} fill={color} fillOpacity={0.2} strokeLinecap="round">
          <rect x={-18} y={-6} width={22} height={12} rx={3} />
          <rect x={4} y={-14} width={18} height={28} rx={4} stroke={accent} />
          <line x1={-26} y1={-2} x2={-18} y2={-2} />
          <line x1={-26} y1={2} x2={-18} y2={2} />
          <line x1={22} y1={-6} x2={26} y2={-6} />
          <line x1={22} y1={6} x2={26} y2={6} />
        </g>
      );
  }
}

// Size-tier pattern: small = tight hex dots, medium = bokeh, large = long
// diagonal bands.
function PatternFor({
  tier,
  color,
  seed,
}: {
  tier: "s" | "m" | "l";
  color: string;
  seed: number;
}) {
  if (tier === "s") {
    // tight dot matrix
    const dots = [];
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 12; x++) {
        const dx = x * 18 + (y % 2 === 0 ? 0 : 9);
        const dy = y * 18 + 6;
        dots.push(<circle key={`${x}-${y}`} cx={dx} cy={dy} r={1.4} fill={color} opacity={0.25} />);
      }
    }
    return <g>{dots}</g>;
  }
  if (tier === "m") {
    // bokeh circles scaled by a deterministic sequence
    const blobs = [];
    let s = seed;
    for (let i = 0; i < 6; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const x = (s % 210) + 5;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const y = (s % 100) + 5;
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const r = (s % 28) + 10;
      blobs.push(<circle key={i} cx={x} cy={y} r={r} fill={color} opacity={0.12} />);
    }
    return <g>{blobs}</g>;
  }
  // large: long diagonal bands
  return (
    <g opacity={0.2}>
      <rect x={-40} y={-20} width={60} height={180} fill={color} transform="rotate(24)" />
      <rect x={100} y={-20} width={40} height={180} fill={color} transform="rotate(24)" opacity={0.6} />
    </g>
  );
}

// Slug a kind:id into the filename we probe in /public/store-art/. Only
// ASCII word chars + `-` survive; everything else becomes `_`.
function slug(kind: Kind, id: string): string {
  return `${kind}-${id}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function StoreArt({
  id,
  kind,
  sizeGb,
  className,
  height = 90,
}: {
  id: string;
  kind: Kind;
  sizeGb?: number;
  className?: string;
  height?: number;
}) {
  // Phase 5: hand-designed key-art lives at /public/store-art/<slug>.webp,
  // registered in /public/store-art/manifest.json. We only render the <img>
  // if the slug is in the manifest — otherwise every card would trigger a
  // 404 probe.
  const [hasOverride, setHasOverride] = useState<boolean | null>(null);
  const mySlug = slug(kind, id);
  useEffect(() => {
    let alive = true;
    loadManifest().then((m) => { if (alive) setHasOverride(m.has(mySlug)); });
    return () => { alive = false; };
  }, [mySlug]);
  const customUrl = `/store-art/${mySlug}.webp`;

  const tier: "s" | "m" | "l" =
    sizeGb == null ? "m" : sizeGb < 10 ? "s" : sizeGb < 30 ? "m" : "l";

  const { bg1, bg2, glyph, accent, pattern } = useMemo(() => {
    const h = hash32(`${kind}:${id}`);
    const baseHue = (KIND_HUE[kind] + ((h >>> 0) % 30) - 15 + 360) % 360;
    const lightHue = (baseHue + 20) % 360;
    const bg1 = hsl(baseHue, 55, 20);
    const bg2 = hsl(lightHue, 60, 12);
    const glyph = hsl(baseHue, 70, 72);
    const accent = hsl((baseHue + 40) % 360, 85, 66);
    const pattern = hsl(baseHue, 60, 55);
    return { bg1, bg2, glyph, accent, pattern };
  }, [id, kind]);

  // Width ~ 2.4× height keeps the card-top banner proportional.
  const width = Math.round(height * 2.44);
  const seed = hash32(`${kind}:${id}`);

  if (hasOverride) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={customUrl}
        alt=""
        width="100%"
        height={height}
        className={className}
        style={{ width: "100%", height, objectFit: "cover", display: "block" }}
        onError={() => setHasOverride(false)}
        aria-hidden="true"
      />
    );
  }

  return (
    <svg
      viewBox={`0 0 220 ${Math.round(height)}`}
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height={height}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`g-${seed}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={bg1} />
          <stop offset="100%" stopColor={bg2} />
        </linearGradient>
      </defs>
      <rect width={220} height={height} fill={`url(#g-${seed})`} />
      <PatternFor tier={tier} color={pattern} seed={seed} />
      <g transform={`translate(${width / 2 - 10} ${height / 2})`}>
        {glyphFor(kind, glyph, accent)}
      </g>
    </svg>
  );
}
