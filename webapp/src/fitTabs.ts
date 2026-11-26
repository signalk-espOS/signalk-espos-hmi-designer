/**
 * Which screen tabs fit in the toolbar. All of them when they do; otherwise
 * the leading ones that fit beside the "more" menu, with the active screen
 * always among them so the tab you are on never disappears.
 *
 * `widths` are the tab widths in order, `avail` the room for the tabs, the
 * add button, the more menu and the gaps between them.
 */
export function fitTabs(
  widths: readonly number[],
  avail: number,
  opts: { add: number; more: number; gap: number; active: number }
): { shown: number[]; overflow: boolean } {
  const all = widths.map((_, i) => i)
  const sum = (ix: readonly number[]): number =>
    ix.reduce((s, i) => s + (widths[i] ?? 0) + opts.gap, 0)
  if (sum(all) + opts.add <= avail) return { shown: all, overflow: false }

  const budget = avail - opts.add - opts.more - opts.gap
  const shown: number[] = []
  let used = 0
  for (const i of all) {
    const w = (widths[i] ?? 0) + opts.gap
    if (used + w > budget) break
    shown.push(i)
    used += w
  }
  if (opts.active >= 0 && opts.active < widths.length) {
    if (!shown.includes(opts.active)) {
      const need = (widths[opts.active] ?? 0) + opts.gap
      while (shown.length > 0 && used + need > budget) {
        const dropped = shown.pop()
        if (dropped !== undefined) used -= (widths[dropped] ?? 0) + opts.gap
      }
      shown.push(opts.active)
    }
  }
  return { shown, overflow: true }
}
