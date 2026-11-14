import type { Widget, WidgetKind } from './schema'

/** Every SK path a widget binds. Top-level for most kinds; the
 *  sub-bars inside a bargroup each contribute their own path. */
export function bindsOf(w: Widget): string[] {
  const out: string[] = []
  if ('bind' in w && w.bind) out.push(w.bind)
  if (w.type === 'bargroup') {
    for (const b of w.bars) if (b.bind) out.push(b.bind)
  }
  return out
}

/** Kinds that drive the panel itself and never take a SignalK bind. */
export const PANEL_LOCAL_KINDS = new Set<WidgetKind>([
  'voice',
  'speaker',
  'mic',
  'volume',
  'stream'
])
