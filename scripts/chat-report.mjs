// Feed already-redacted uicto_chat JSON lines via stdin. Ignore other log records.
import { createInterface } from "node:readline";
const counts = new Map(),
  categories = new Map(),
  samples = new Map();
for await (const line of createInterface({ input: process.stdin })) {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  if (e.event !== "uicto_chat" || typeof e.outcome !== "string") continue;
  counts.set(e.outcome, (counts.get(e.outcome) ?? 0) + 1);
  if (e.category)
    categories.set(e.category, (categories.get(e.category) ?? 0) + 1);
  for (const [k, v] of Object.entries({ total: e.latency_ms, ...e.timings })) {
    if (!Number.isFinite(v) || v < 0) continue;
    if (!samples.has(k)) samples.set(k, []);
    samples.get(k).push(v);
  }
}
const latency = {};
for (const [stage, list] of samples) {
  list.sort((a, b) => a - b);
  latency[stage] = {
    count: list.length,
    p50: list[Math.ceil(list.length * 0.5) - 1],
    p95: list[Math.ceil(list.length * 0.95) - 1],
  };
}
console.log(
  JSON.stringify(
    {
      outcomes: Object.fromEntries(counts),
      supported_by_category: Object.fromEntries(categories),
      latency_ms: latency,
    },
    null,
    2,
  ),
);
