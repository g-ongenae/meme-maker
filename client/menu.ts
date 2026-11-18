// The header's Create menu: a popover (closed by Escape or a click outside) under its button,
// browsed with the arrow keys.

import { $ } from './dom.ts';

export function createMenu(buttonId: string, menuId: string): void {
  const button = $<HTMLButtonElement>(buttonId);
  const menu = $(menuId);
  const items = (): HTMLElement[] => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];

  // Under the button, right-aligned with it.
  menu.addEventListener('beforetoggle', (e) => {
    const open = (e as ToggleEvent).newState === 'open';
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const r = button.getBoundingClientRect();
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${document.documentElement.clientWidth - r.right}px`;
  });
  menu.addEventListener('toggle', (e) => {
    if ((e as ToggleEvent).newState === 'open') items()[0]?.focus();
  });
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[role="menuitem"]')) menu.hidePopover();
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
}
