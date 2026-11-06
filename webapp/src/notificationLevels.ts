// Per-level alert settings (notifications.levels): what the dialog edits
// and what it writes back. A state the layout leaves out keeps what
// min_state implies on the device, and min_state is still written, as the
// lowest shown level, for firmware that does not know `levels`.

import type {
  NotificationLevel,
  NotificationsConfig,
  NotificationSound,
  NotificationState
} from './schema'

export const NOTIFICATION_STATES: NotificationState[] = [
  'alert',
  'warn',
  'alarm',
  'emergency'
]

export const SOUND_OPTIONS: { value: NotificationSound; label: string }[] = [
  { value: 'off', label: 'off' },
  { value: 'source', label: 'as the source asks' },
  { value: 'always', label: 'always' }
]

/** 0 plays once; the rest repeat until the alert is acknowledged. */
export const REPEAT_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'once' },
  { value: 5, label: 'every 5 s' },
  { value: 10, label: 'every 10 s' },
  { value: 30, label: 'every 30 s' },
  { value: 60, label: 'every 60 s' }
]

export type EffectiveLevels = Record<
  NotificationState,
  Required<NotificationLevel>
>

const rank = (s: NotificationState): number => NOTIFICATION_STATES.indexOf(s)

/** Every state's settings as the device applies them: min_state's
 *  defaults (shown and sounding as the source asks from min_state up),
 *  overridden by whatever `levels` sets. */
export const effectiveLevels = (cfg?: NotificationsConfig): EffectiveLevels => {
  const min = cfg?.min_state ?? 'alarm'
  const out = {} as EffectiveLevels
  for (const s of NOTIFICATION_STATES) {
    const on = rank(s) >= rank(min)
    const l = cfg?.levels?.[s]
    out[s] = {
      show: l?.show ?? on,
      sound: l?.sound ?? (on ? 'source' : 'off'),
      repeat_s: l?.repeat_s ?? 0
    }
  }
  return out
}

/** The lowest shown state, which older firmware reads as min_state.
 *  With nothing shown, the most severe one: the closest it can come. */
export const minStateFor = (levels: EffectiveLevels): NotificationState =>
  NOTIFICATION_STATES.find((s) => levels[s].show) ?? 'emergency'

/** The config the dialog writes after a change to one state. */
export const withLevel = (
  cfg: NotificationsConfig | undefined,
  state: NotificationState,
  change: NotificationLevel
): NotificationsConfig => {
  const levels = effectiveLevels(cfg)
  levels[state] = { ...levels[state], ...change }
  return {
    enabled: cfg?.enabled ?? true,
    min_state: minStateFor(levels),
    ack_method: 'modal',
    levels
  }
}
