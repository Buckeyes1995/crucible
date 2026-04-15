"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GitBranch, Play, Save, Loader2 } from "lucide-react";

const BASE = "/api";

type RouterConfig = {
  enabled: boolean;
  rules: {
    name: string;
    description: string;
    classifier: string;
    model_pattern: string | null;
    model_id: string | null;
    min_size_gb?: number;
    max_size_gb?: number;
    priority: number;
  }[];
  default_model: string | null;
};

type ClassifyResult = {
  scores: Record<string, number>;
  selected_model: string | null;
  category: string | null;
};

const CLASSIFIERS = ["code", "math", "reasoning", "short", "long"];
const SCORE_COLORS: Record<string, string> = {
  code: "bg-indigo-500",
  math: "bg-emerald-500",
  reasoning: "bg-amber-500",
  short: "bg-cyan-500",
  long: "bg-purple-500",
};

export default function SmartRouterPage() {
  const [config, setConfig] = useState<RouterConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [testPrompt, setTestPrompt] = useState("");
  const [testResult, setTestResult] = useState<ClassifyResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/smart-router/config`).then((r) => r.json()).then(setConfig);
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    await fetch(`${BASE}/smart-router/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    setSaving(false);
  }

  async function testClassify() {
    if (!testPrompt.trim()) return;
    setTesting(true);
    const r = await fetch(`${BASE}/smart-router/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: testPrompt }),
    });
    setTestResult(await r.json());
    setTesting(false);
  }

  if (!config) return <div className="p-8 text-zinc-500">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitBranch className="w-6 h-6 text-indigo-400" />
          <h1 className="text-xl font-semibold text-zinc-100">Smart Router</h1>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              className="rounded"
            />
            Enabled
          </label>
          <Button onClick={save} variant="primary" className="gap-1.5 text-xs" disabled={saving}>
            <Save className="w-3.5 h-3.5" /> Save
          </Button>
        </div>
      </div>

      <p className="text-sm text-zinc-500">
        Auto-select the best model based on prompt content. When enabled, the <code className="text-xs bg-zinc-800 px-1 rounded">/v1/chat/completions</code> proxy routes to the matched model via oMLX.
      </p>

      {/* Test classifier */}
      <Card>
        <CardHeader><CardTitle>Test Classifier</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={testPrompt}
              onChange={(e) => setTestPrompt(e.target.value)}
              placeholder="Type a prompt to test routing…"
              className="flex-1"
              onKeyDown={(e) => e.key === "Enter" && testClassify()}
            />
            <Button onClick={testClassify} disabled={testing} variant="ghost" className="gap-1.5">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Test
            </Button>
          </div>
          {testResult && (
            <div className="space-y-2">
              <div className="flex gap-2">
                {Object.entries(testResult.scores).map(([cat, score]) => (
                  <div key={cat} className="flex items-center gap-1.5">
                    <div className={cn("w-2 h-2 rounded-full", SCORE_COLORS[cat] ?? "bg-zinc-500")} />
                    <span className="text-xs text-zinc-400">{cat}</span>
                    <span className="text-xs font-mono text-zinc-300">{(score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              <div className="text-sm">
                <span className="text-zinc-500">Routed to: </span>
                <span className="text-indigo-300 font-medium">{testResult.selected_model ?? "(default / active model)"}</span>
                <span className="text-zinc-600 ml-2">({testResult.category})</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rules */}
      <Card>
        <CardHeader><CardTitle>Routing Rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {config.rules.map((rule, i) => (
            <div key={i} className="p-3 rounded-lg border border-white/[0.06] bg-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-200">{rule.name}</span>
                <span className="text-xs text-zinc-500">Priority: {rule.priority}</span>
              </div>
              <p className="text-xs text-zinc-500">{rule.description}</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <label className="text-zinc-500">Classifier</label>
                  <select
                    className="w-full bg-zinc-800 border border-white/[0.06] rounded px-2 py-1 text-zinc-300 mt-1"
                    value={rule.classifier}
                    onChange={(e) => {
                      const rules = [...config.rules];
                      rules[i] = { ...rules[i], classifier: e.target.value };
                      setConfig({ ...config, rules });
                    }}
                  >
                    {CLASSIFIERS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-zinc-500">Model Pattern</label>
                  <Input
                    className="mt-1 text-xs"
                    value={rule.model_pattern ?? ""}
                    onChange={(e) => {
                      const rules = [...config.rules];
                      rules[i] = { ...rules[i], model_pattern: e.target.value || null };
                      setConfig({ ...config, rules });
                    }}
                    placeholder="e.g. Coder"
                  />
                </div>
                <div>
                  <label className="text-zinc-500">Model ID (override)</label>
                  <Input
                    className="mt-1 text-xs"
                    value={rule.model_id ?? ""}
                    onChange={(e) => {
                      const rules = [...config.rules];
                      rules[i] = { ...rules[i], model_id: e.target.value || null };
                      setConfig({ ...config, rules });
                    }}
                    placeholder="exact model name"
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Default model */}
      <Card>
        <CardHeader><CardTitle>Default Model</CardTitle></CardHeader>
        <CardContent>
          <Input
            value={config.default_model ?? ""}
            onChange={(e) => setConfig({ ...config, default_model: e.target.value || null })}
            placeholder="Leave blank to use currently loaded model"
          />
          <p className="text-xs text-zinc-500 mt-2">Used when no routing rule matches.</p>
        </CardContent>
      </Card>
    </div>
  );
}
