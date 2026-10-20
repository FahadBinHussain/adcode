/**
 * The app's own menus, behind one button.
 *
 * The desktop window has always drawn File, Edit, Selection and the rest along the left of its
 * title bar - a permanent row of eight words for menus most people open twice a session, and, on
 * Windows, a row of words sitting where the window's own controls want to be. The frame has no
 * title bar at all, so the bar moves into a card that opens from the button in the sidebar's
 * brand row.
 *
 * Nothing about the menus themselves moves. It is the real `menuBar.ts` in the card, so the
 * panels, the mnemonics, the accelerators, the recent projects and every command behind them are
 * the same objects the Code window shows, and Alt+F and Alt+G keep working from the keyboard.
 *
 * What this file owns is the two things a bar inside a card cannot know:
 *
 *  - it has to be on screen *before* the bar is asked for a menu. `openByMnemonic` lays its
 *    panel out against the bar's own offsets, and a hidden bar has none - so Alt+F shows the
 *    card first and opens File inside it, rather than opening a menu nobody can see;
 *  - and it has to go away when the bar is done - a command chosen, Escape, a click somewhere
 *    else, or Tab out of it. Focus is handed back to whatever had it (the button takes focus
 *    back when that was a click), because a menu that leaves the keyboard nowhere is worse than
 *    no menu.
 */
import { createIcon } from "./icons.ts";
import { WEB_ICON } from "./webIcons.ts";
import type { MenuBar } from "./menuBar.ts";

export interface AppMenu {
  /** The trigger, for the frame's brand row. */
  readonly element: HTMLButtonElement;
  /** The trigger's press: show the bar, or put it away if it is already showing. */
  toggle(): void;
  /**
   * Show the card and run something with the bar in it. A press nothing claimed - Alt with a
   * letter no menu owns - leaves no card behind.
   */
  reveal(act: () => boolean): void;
  close(): void;
  isOpen(): boolean;
}

export function createAppMenu(deps: { readonly bar: MenuBar }): AppMenu {
  const element = document.createElement("button");
  element.type = "button";
  // The frame's own brand-row button - same box, same hover as the search button beside it.
  element.className = "web-sidebar-search web-sidebar-menu";
  element.title = "Main menu (Alt)";
  element.setAttribute("aria-label", "Main menu");
  element.setAttribute("aria-haspopup", "menu");
  element.setAttribute("aria-expanded", "false");
  element.append(createIcon(WEB_ICON.menu));

  const host = document.createElement("div");
  host.className = "app-menu";
  host.hidden = true;
  host.append(deps.bar.element);
  document.body.append(host);

  function place(): void {
    const box = element.getBoundingClientRect();
    host.style.top = `${Math.round(box.bottom + 6)}px`;
    // Aligned with the button, then pulled back inside the window - a card that hangs off the
    // edge is a card with a menu on it that cannot be read.
    const left = Math.min(Math.round(box.left), window.innerWidth - host.offsetWidth - 8);
    host.style.left = `${Math.max(8, left)}px`;
  }

  function show(): void {
    if (!host.hidden) {
      place();
      return;
    }
    host.hidden = false;
    place();
    element.setAttribute("aria-expanded", "true");
  }

  /**
   * Put the card away.
   *
   * `restore` is whether the keyboard goes back where it came from: true when the person asked
   * to leave the menu (the trigger again, Escape), false when something else decided for them
   * (a command ran, a click landed elsewhere) - there focus belongs to whatever happened next.
   */
  function hide(restore: boolean): void {
    if (host.hidden) return;
    // `focusBar` is the bar's own toggle: with focus inside it closes what is open and calls the
    // editor back; without focus it would *take* focus, so a card being dismissed quietly just
    // closes its panels.
    if (restore && deps.bar.isFocused()) deps.bar.focusBar();
    else deps.bar.close();
    host.hidden = true;
    element.setAttribute("aria-expanded", "false");
  }

  element.addEventListener("click", () => {
    if (!host.hidden) {
      hide(true);
      return;
    }
    show();
    // Focused, not opened: Alt has always put the bar into a waiting state and let the next key
    // decide which menu - a click on the button reads the same way.
    deps.bar.focusBar();
  });

  // A press anywhere else puts it away, as it does for every menu. The trigger is left out: its
  // own click decides, and closing here would turn the second press into an open.
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target as Node | null;
      if (host.hidden || target === null) return;
      if (host.contains(target) || element.contains(target)) return;
      hide(false);
    },
    true,
  );

  /*
   * Escape, in two steps.
   *
   * The bar's own handler uses it one level at a time - a submenu closes back onto its row, the
   * root panel closes back onto the bar - and must keep doing so, so this one stands aside while
   * a panel is open. Once nothing is open, the same key is the card's exit, wherever focus is.
   */
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || host.hidden || deps.bar.isOpen()) return;
      hide(true);
    },
    true,
  );

  // Focus leaving the card - Tab from the bar, or a click back into the conversation - ends it.
  // Read a frame later, because `focusout` fires before the new target is known.
  host.addEventListener("focusout", () => {
    requestAnimationFrame(() => {
      if (host.hidden) return;
      const active = document.activeElement;
      if (active !== null && (host.contains(active) || element.contains(active))) return;
      hide(false);
    });
  });

  // A command was chosen: the bar closes itself and there is nothing left to show.
  host.addEventListener("click", () => {
    if (!deps.bar.isOpen()) hide(false);
  });

  window.addEventListener("blur", () => hide(false));

  return {
    element,
    toggle: () => element.click(),
    reveal(act): void {
      show();
      if (!act()) hide(false);
    },
    close: () => hide(false),
    isOpen: () => !host.hidden,
  };
}
