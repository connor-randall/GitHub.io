// Turn raw chest rolls into a compact, stable ledger for the OPEN ALL reveal.

/** @param {any[]} results */
export function summarizeBoxResults(results) {
  /** @type {Map<string, any>} */
  const grouped = new Map();
  for (const result of results) {
    let key;
    if (result.kind === "item") key = `item:${result.item_id}:${result.autosold ? "sold" : "kept"}`;
    else if (result.kind === "scroll") key = `scroll:${result.scroll_id}`;
    else if (result.kind === "box") key = `box:${result.box_got}`;
    else if (result.capped) key = "capped"; // ticket #346: past the daily limit, paid in shards
    else key = result.kind;
    const row = grouped.get(key) ?? {
      kind: key === "capped" ? "capped" : result.kind,
      item_id: result.item_id ?? null,
      scroll_id: result.scroll_id ?? null,
      ...(result.kind === "box" ? { box_got: result.box_got } : {}), // ticket #72: a chest in the chest
      count: 0,
      amount: 0,
      autosold: 0,
      overflow: 0,
    };
    row.count += 1;
    row.amount += Number(result.amount) || 0;
    row.autosold += Number(result.autosold) || 0;
    row.overflow += Number(result.overflow_shards) || 0; // ticket #240: past the cap, paid in shards
    grouped.set(key, row);
  }
  return [...grouped.values()];
}
