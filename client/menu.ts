// The header's Create menu: a popover (closed by Escape or a click outside) under its button,
// browsed with the arrow keys.

import { $ } from './dom.ts';

export interface Menu {
  /** Closes it, handing the focus back to its button if it was inside. */
  close(): void;
}

// Kept clear of the viewport's edges.
const MARGIN = 8;

export function createMenu(buttonId: string, menuId: string): Menu {
  const button = $<HTMLButtonElement>(buttonId);
  const menu = $(menuId);
  const items = (): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];

  // A dialog opened from the menu gives the focus back to the button when it closes, not to
  // a hidden item.
  const close = () => {
    if (!menu.matches(':popover-open')) return;
    if (menu.contains(document.activeElement)) button.focus();
    menu.hidePopover();
  };

  // Under the button, right-aligned with it unless that leaves the viewport.
  menu.addEventListener('beforetoggle', (e) => {
    const open = (e as ToggleEvent).newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const r = button.getBoundingClientRect();
    const { clientWidth, clientHeight } = document.documentElement;
    const width = Math.min(parseFloat(getComputedStyle(menu).width) || 0, clientWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(r.right - width, clientWidth - MARGIN - width));
    menu.style.left = `${left}px`;
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.maxHeight = `${Math.max(0, clientHeight - r.bottom - 6 - MARGIN)}px`;
  });
  menu.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState === 'open') items()[0]?.focus();
  });
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[role="menuitem"]')) close();
  });
  menu.addEventListener('keydown', (e) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    let to: number;
    if (e.key === 'ArrowDown') to = (at + 1) % all.length;
    else if (e.key === 'ArrowUp') to = (at - 1 + all.length) % all.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = all.length - 1;
    else if (e.key === 'Tab') return menu.hidePopover();
    else return;
    e.preventDefault();
    all[to]?.focus();
  });
  addEventListener('resize', () => menu.hidePopover());
  return { close };
}
