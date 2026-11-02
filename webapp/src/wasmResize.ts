// The wasm preview creates its LVGL display once, at the size the designer
// knows when the page loads: the 1024x600 default, before any device is
// connected. A device of another size then got a canvas resized by React
// while LVGL kept drawing the old resolution, and the preview went blank.

/** The part of the wasm module that resizes the LVGL display. Optional:
 *  bundles built before espos-p4-cockpit-wasm added it do not export it. */
export interface ResizableWasm {
  _jlp_resize?: (w: number, h: number) => number
}

export interface DisplaySize {
  w: number
  h: number
}

/** Moves the wasm display from `current` to `w`x`h` and updates `current`.
 *  Returns null on success, or a status line for the toolbar when the
 *  bundle cannot follow the device. */
export const resizeWasmDisplay = (
  mod: ResizableWasm,
  current: DisplaySize,
  w: number,
  h: number
): string | null => {
  if (current.w === w && current.h === h) return null
  if (!mod._jlp_resize) {
    return `preview cannot follow the ${w}x${h} device: this wasm bundle has no jlp_resize; use Mirror`
  }
  const rc = mod._jlp_resize(w, h)
  if (rc !== 0) return `resize to ${w}x${h} failed: ${rc}`
  current.w = w
  current.h = h
  return null
}
