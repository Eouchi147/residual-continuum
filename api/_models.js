/**
 * Residual Continuum: free-model picker for OpenRouter
 * ------------------------------------------------------------------
 * Files that start with "_" are not deployed as endpoints; ask.js and
 * draft.js import this one.
 *
 * What it guarantees:
 * 1. Only free models are ever called. The live model list is filtered to
 *    models priced at exactly zero, and every request also carries a
 *    provider price cap of zero, so OpenRouter refuses rather than bills.
 * 2. New models are picked up without a redeploy. The list is read from
 *    OpenRouter's public catalogue every 30 minutes, so a model released
 *    today becomes a candidate within the hour and a withdrawn one drops out.
 * 3. No single model is a point of failure. Requests are "hedged": the best
 *    candidate starts first; if it has not answered within a few seconds, or
 *    fails, the next one starts alongside it, and the first usable answer
 *    wins. A model that errors, times out or returns unusable output is
 *    benched for a while. The free router "openrouter/free" is the last resort.
 *
 * How "best" is judged, with no benchmark API to ask: general-purpose chat
 * models only (safety classifiers, coding, music, finance or health
 * specialists and tiny models are left out), then a score from the lab's
 * track record, model size and recency, adjusted by what OpenRouter reports
 * about each model's uptime and by how fast and reliable it has actually
 * been for this site. Previews and "stealth" models count, a little lower,
 * because they can vanish.
 *
 * Optional environment variable:
 *   FREE_MODELS_PREFER  comma-separated model ids to try first. Ignored
 *                       unless the id is currently free.
 */

const API = "https://openrouter.ai/api/v1";
const LIST_TTL = 30 * 60 * 1000;
const BENCH_MS = 15 * 60 * 1000;
const LAST_RESORT = "openrouter/free";

/* Used only if the catalogue cannot be read and nothing is cached. */
const SEED = [
  "qwen/qwen3.8-27b:free",
  "thinkingmachines/inkling:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
];

/* Labs with a record of strong general models. Higher = preferred. */
const FAMILY = [
  [/deepseek/i, 30], [/nemotron[^/]*(ultra|super)/i, 28], [/qwen/i, 28],
  [/inkling(?!-small)/i, 27], [/kimi|moonshot/i, 27], [/gpt-oss|openai\//i, 26],
  [/glm|z-ai\//i, 26], [/minimax/i, 24], [/llama-?4|llama-3\.3-70b/i, 22],
  [/gemma-?[3-9]/i, 22], [/mistral|magistral/i, 20], [/hermes/i, 18],
  [/dots/i, 18], [/nemotron/i, 16], [/inkling-small/i, 16],
];
const EXCLUDE = /(safety|guard|moderation|embed|rerank|ocr|lyria|music|tts|whisper|coder|[-/]code|laguna|-fin\b|-fin:|-sante|-med\b|-med:|clip)/i;

let cache = { at: 0, list: null };      // [{ id, base }]
const benched = new Map();              // id -> benched until (ms)
const why = new Map();                  // id -> last failure, shown by GET /api/ask
const perf = new Map();                 // id -> { ms (moving average), ok, fail }
const served = [];                      // recent successes, for GET /api/ask

const isFree = (m) => {
  const p = m.pricing || {};
  return Number(p.prompt) === 0 && Number(p.completion) === 0
    && (p.request == null || Number(p.request) === 0);
};

function baseScore(m, now) {
  const id = m.id;
  let s = 0;
  for (const [re, w] of FAMILY) if (re.test(id)) { s += w; break; }
  const b = id.match(/(\d+(?:\.\d+)?)b(?![a-z0-9])/i);
  if (b) {
    const size = parseFloat(b[1]);
    if (size < 12) return -1;                     /* too small to follow the rules reliably */
    s += Math.min(20, 6 * Math.log2(size / 8));
  } else s += 8;
  const ageMonths = (now / 1000 - (m.created || 0)) / (30 * 86400);
  s += Math.max(0, 10 - ageMonths * 0.6);
  if (/stealth|alpha|preview|beta|experimental/i.test(id)) s -= 12;
  return s;
}

async function getJSON(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* OpenRouter's own health figures for a model: uptime over the last 30 minutes. */
async function uptimePenalty(id) {
  try {
    const eps = (await getJSON(`${API}/models/${id}/endpoints`, 3000)).data?.endpoints || [];
    if (!eps.length) return 25;
    const best = Math.max(...eps.map((e) => (e.status < 0 ? 0.6 : 1) * (e.uptime_last_30m ?? 95)));
    return Math.max(0, (100 - best) * 0.6);
  } catch (_) { return 0; }
}

async function fetchList() {
  const all = (await getJSON(`${API}/models`, 6000)).data || [];
  const now = Date.now();
  const list = all
    .filter((m) => m.id !== LAST_RESORT && isFree(m))
    .filter((m) => (m.context_length || 0) >= 16000)
    .filter((m) => {
      const a = m.architecture || {};
      const out = a.output_modalities || ["text"], inp = a.input_modalities || ["text"];
      return out.includes("text") && inp.includes("text") && !EXCLUDE.test(m.id);
    })
    .map((m) => ({ id: m.id, base: baseScore(m, now) }))
    .filter((x) => x.base >= 0)
    .sort((a, b) => b.base - a.base)
    .slice(0, 12);
  const pen = await Promise.all(list.map((x) => uptimePenalty(x.id)));
  list.forEach((x, i) => { x.base -= pen[i]; });
  return list;
}

/* What this site has seen: slow or failing models sink, fast reliable ones rise. */
function liveScore(x) {
  const p = perf.get(x.id);
  if (!p) return x.base;
  const slow = p.ms ? Math.max(0, (p.ms - 4000) / 1000) * 1.5 : 0;
  const rel = (p.ok + 1) / (p.ok + p.fail + 2);
  return x.base - Math.min(20, slow) - (1 - rel) * 20;
}

/** Ranked free model ids, best first, with benched models moved to the back. */
export async function freeModels() {
  const now = Date.now();
  if (!cache.list || now - cache.at > LIST_TTL) {
    try { const l = await fetchList(); if (l.length) cache = { at: now, list: l }; }
    catch (e) { if (!cache.list) cache = { at: now - LIST_TTL + 60_000, list: SEED.map((id, i) => ({ id, base: 50 - i })) }; }
  }
  let list = cache.list.slice().sort((a, b) => liveScore(b) - liveScore(a)).map((x) => x.id);
  const prefer = String(process.env.FREE_MODELS_PREFER || "").split(",").map((s) => s.trim())
    .filter((id) => id && list.includes(id));
  list = [...prefer, ...list.filter((id) => !prefer.includes(id))];
  const ok = list.filter((id) => !(benched.get(id) > now));
  const bad = list.filter((id) => benched.get(id) > now);
  return [...ok, ...bad];
}

export function modelStatus() {
  const now = Date.now();
  return {
    updated: cache.at ? new Date(cache.at).toISOString() : null,
    ranked: (cache.list || []).slice().sort((a, b) => liveScore(b) - liveScore(a)).map((x) => x.id),
    benched: [...benched].filter(([, u]) => u > now).map(([id]) => ({ id, why: why.get(id) || "" })),
    served: served.slice(-10),
    last_resort: LAST_RESORT,
  };
}

function bench(id, ms, reason) {
  benched.set(id, Date.now() + ms);
  why.set(id, String(reason || "").slice(0, 140));
  const p = perf.get(id) || { ms: 0, ok: 0, fail: 0 };
  p.fail++; perf.set(id, p);
}
function record(id, ms) {
  const p = perf.get(id) || { ms: 0, ok: 0, fail: 0 };
  p.ok++; p.ms = p.ms ? p.ms * 0.6 + ms * 0.4 : ms; perf.set(id, p);
  served.push(`${id} ${(ms / 1000).toFixed(1)}s`); if (served.length > 20) served.shift();
}

function slowNote(id, ms) {
  if (ms < 3000) return;
  const p = perf.get(id) || { ms: 0, ok: 0, fail: 0 };
  p.ms = Math.max(p.ms, ms * 1.2); perf.set(id, p);
}

/* One attempt on one model. Resolves with the parsed value or rejects. */
async function attempt(id, req, signal) {
  const t0 = Date.now();
  const r = await fetch(`${API}/chat/completions`, {
    method: "POST", signal,
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://residual-continuum.vercel.app",
      "X-Title": req.title || "Residual Continuum",
    },
    body: JSON.stringify({
      model: id, messages: req.messages, temperature: req.temperature, max_tokens: req.max_tokens,
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
      reasoning: { effort: req.effort, exclude: true },
      provider: { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } },
    }),
  });
  if (!r.ok) {
    let msg = ""; try { msg = (await r.json())?.error?.message || ""; } catch (_) {}
    const err = new Error(`model ${r.status} ${msg}`.trim());
    err.status = r.status;
    throw err;
  }
  const out = await r.json();
  if (out.error) throw new Error(`model error ${out.error.code || ""} ${out.error.message || ""}`.trim());
  const text = (out.choices?.[0]?.message?.content || "").trim();
  if (!text) throw Object.assign(new Error("empty reply"), { soft: true });
  let value;
  try { value = req.parse(text); } catch (_) { throw Object.assign(new Error("unusable reply"), { soft: true }); }
  record(id, Date.now() - t0);
  return { value, model: out.model || id };
}

/**
 * Run a chat completion on the best free model that returns usable output.
 * `parse(text)` must return the parsed value or throw.
 * Returns { value, model }.
 */
export async function chatFree({ messages, temperature = 0.2, max_tokens = 900, parse, title,
  budgetMs = 28_000, hedgeMs = 6_000, maxParallel = 3, effort = "minimal", json = true }) {
  const req = { messages, temperature, max_tokens, parse, title, effort, json };
  const queue = [...(await freeModels()), LAST_RESORT];
  const start = Date.now();

  return await new Promise((resolve, reject) => {
    const running = new Map();   // id -> AbortController
    const began = new Map();     // id -> start time
    let done = false, lastErr = "no free model available", hedgeTimer = null, budgetTimer = null;

    const finish = (fn, v) => {
      if (done) return; done = true;
      clearTimeout(hedgeTimer); clearTimeout(budgetTimer);
      /* models still thinking when another answered count as slow next time */
      for (const id of running.keys()) slowNote(id, Date.now() - began.get(id));
      for (const c of running.values()) c.abort();
      fn(v);
    };
    budgetTimer = setTimeout(() => {
      for (const id of running.keys()) bench(id, 5 * 60_000, "timeout");
      finish(reject, new Error(lastErr === "no free model available" ? "timeout" : lastErr));
    }, budgetMs);

    const launch = () => {
      if (done) return;
      clearTimeout(hedgeTimer);
      if (running.size >= maxParallel || !queue.length) {
        if (!running.size && !queue.length) finish(reject, new Error(lastErr));
        return;
      }
      const id = queue.shift();
      const ctl = new AbortController();
      running.set(id, ctl); began.set(id, Date.now());
      attempt(id, req, ctl.signal).then(
        (res) => finish(resolve, res),
        (e) => {
          running.delete(id);
          if (done) return;
          if (e.name === "AbortError") return;
          lastErr = String(e.message || e).slice(0, 160);
          if (e.status === 401 || e.status === 402) return finish(reject, e);   /* key problem: no model can help */
          bench(id, e.status === 429 ? 3 * 60_000 : e.soft ? 10 * 60_000 : BENCH_MS, lastErr);
          launch();                                                            /* replace it at once */
        });
      if (Date.now() - start < budgetMs - 2000) hedgeTimer = setTimeout(launch, hedgeMs);
    };
    launch();
  });
}

/** Pull the first JSON object out of a model reply (fences, preambles and all). */
export function extractJSON(text) {
  const t = String(text).replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("no JSON in reply");
  return JSON.parse(t.slice(a, b + 1));
}
