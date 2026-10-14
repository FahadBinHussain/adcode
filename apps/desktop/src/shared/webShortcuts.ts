/**
 * Default shortcuts for the web version, where the browser keeps some chords for itself.
 *
 * In a browser tab, Ctrl+N, Ctrl+Shift+N, Ctrl+W, Ctrl+T and friends open or close windows and
 * tabs before the page sees the key. The commands bound to them by default move to Alt on the
 * web; anything the person rebinds themselves is applied on top of these, so it always wins.
 */
import type { Binding, BindingOverrides } from "./keybindings.ts";

const RESERVED: Readonly<Record<string, string>> = {
  "cmdorctrl+shift+n": "Alt+N",
  "cmdorctrl+n": "Alt+Shift+N",
  "cmdorctrl+w": "Alt+W",
  "cmdorctrl+shift+w": "Alt+Shift+W",
  "cmdorctrl+t": "Alt+T",
  "cmdorctrl+shift+t": "Alt+Shift+T",
  "cmdorctrl+tab": "Alt+PageDown",
  "cmdorctrl+shift+tab": "Alt+PageUp",
};

export function webShortcutOverrides(bindings: readonly Binding[]): BindingOverrides {
  const overrides: Record<string, string> = {};
  for (const binding of bindings) {
    if (binding.nativeRole || binding.defaultChord === null) continue;
    const moved = RESERVED[binding.defaultChord.toLowerCase().replace(/^ctrl\+/, "cmdorctrl+")];
    if (moved !== undefined) overrides[binding.command] = moved;
  }
  return overrides;
}
