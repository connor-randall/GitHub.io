// Turn raw chest rolls into a compact, stable ledger for the OPEN ALL reveal.

/** @param {any[]} results */
export function summarizeBoxResults(results) {
  /** @type {Map<string, any>} */
  const grouped = new Map();
  for (const result of results) {
    let key;
    if (result.kind === "item") key = `item:${result.item_id}:${result.autosold ? "sold" : "kept"}`;
    else if (result.kind === "scroll") key = `scroll:${result.scroll_id}`;
    else key = result.kind;
    const row = grouped.get(key) ?? {
      kind: result.kind,
      item_id: result.item_id ?? null,
      scroll_id: result.scroll_id ?? null,
      count: 0,
      amount: 0,
      autosold: 0,
    };
    row.count += 1;
    row.amount += Number(result.amount) || 0;
    row.autosold += Number(result.autosold) || 0;
    grouped.set(key, row);
  }
  return [...grouped.values()];
}
