// Gate 13 (MASTER_PLAN PC gate 13): the budgets, how a run's measurements are summarized, and
// how they are judged. Shared by tests/editor-performance.test.mjs, which measures one run, and
// scripts/gate13-reference.mjs, which judges five on the reference machine (#275).

/**
 * The budgets, unchanged since PC gate 13. `stat` is what is held to the budget: the single
 * first-render time, or a measure's p95.
 */
export const GATE13_BUDGETS = Object.freeze([
  { key: "firstRender", label: "first render of 10,000 nodes", stat: "value", budget: 2000 },
  { key: "apply", label: "applying a change from elsewhere", stat: "p95", budget: 100 },
  { key: "insert", label: "applying an inserted card", stat: "p95", budget: 100 },
  { key: "remove", label: "applying a removed card", stat: "p95", budget: 100 },
  { key: "edit", label: "end-to-end edit in the editor", stat: "p95", budget: 750 },
  { key: "delete", label: "deleting a layer in the editor", stat: "p95", budget: 750 },
]);

/** The nearest-rank percentile of `values`, as the gate has always computed its p95. */
export function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

/** A measure's samples as the record keeps them: count, p50, p95 and maximum, in ms. */
export function summarize(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error("a measure needs at least one sample");
  const round = (value) => Math.round(value * 10) / 10;
  return { n: samples.length, p50: round(percentile(samples, 0.5)), p95: round(percentile(samples, 0.95)), max: round(Math.max(...samples)) };
}

/** The value a budget is held to in one run's `measures`. */
export const heldValue = (measures, budget) => (budget.stat === "value" ? measures[budget.key].value : measures[budget.key].p95);

/** The budgets one run's `measures` exceed, each with its value. */
export function overruns(measures) {
  return GATE13_BUDGETS.filter((budget) => heldValue(measures, budget) > budget.budget).map((budget) => ({ ...budget, value: heldValue(measures, budget) }));
}

/**
 * The measures more than 50% above the last recorded baseline for this runner OS, which the
 * founder's protocol says to investigate, not to fail on (#275).
 */
export function regressions(measures, baseline) {
  if (baseline === undefined) return [];
  return GATE13_BUDGETS.filter((budget) => typeof baseline[budget.key] === "number" && heldValue(measures, budget) > baseline[budget.key] * 1.5)
    .map((budget) => ({ ...budget, value: heldValue(measures, budget), baseline: baseline[budget.key] }));
}

const median = (values) => percentile(values, 0.5);

/**
 * Judge five runs on the reference machine (#275): a budget passes when it holds in at least
 * four of the five runs and the median of the five held values is within it.
 */
export function judgeReference(runs) {
  if (!Array.isArray(runs) || runs.length !== 5) throw new Error(`the reference protocol judges exactly five runs, not ${runs?.length}`);
  return GATE13_BUDGETS.map((budget) => {
    const values = runs.map((measures) => heldValue(measures, budget));
    const held = values.filter((value) => value <= budget.budget).length;
    const medianValue = median(values);
    return { key: budget.key, label: budget.label, stat: budget.stat, budget: budget.budget, values, held, median: medianValue, pass: held >= 4 && medianValue <= budget.budget };
  });
}
