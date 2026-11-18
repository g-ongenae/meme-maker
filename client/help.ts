// The help panel, listing the keyboard shortcuts.

import { $ } from './dom.ts';
import { type Keys, SHORTCUTS } from './shortcuts.ts';

export interface Help {
  toggle(): void;
  readonly isOpen: boolean;
}

const apple = /Mac|iPhone|iPad/.test(navigator.platform);

function kbd(key: string): HTMLElement {
  const el = document.createElement('kbd');
  el.textContent = apple ? key.replace(/^Ctrl$/, '⌘').replace(/^Alt$/, '⌥') : key;
  return el;
}

// A chord's keys joined with "+", and a sequence's with "then".
function keysOf(keys: Keys): Node[] {
  return keys.flatMap((step, i) => [
    ...(i ? [document.createTextNode(' then ')] : []),
    ...step
      .split(/(?<=.)\+(?=.)/)
      .flatMap((key, j) => (j ? [document.createTextNode('+'), kbd(key)] : [kbd(key)])),
  ]);
}

export function createHelp(): Help {
  const dialog = $<HTMLDialogElement>('help');
  $('helpGroups').replaceChildren(
    ...SHORTCUTS.map((group) => {
      const section = document.createElement('section');
      const title = document.createElement('h3');
      title.textContent = group.title;
      const list = document.createElement('dl');
      for (const shortcut of group.shortcuts) {
        const dt = document.createElement('dt');
        dt.append(
          ...shortcut.keys.flatMap((keys, i) => [
            ...(i ? [document.createTextNode(' or ')] : []),
            ...keysOf(keys),
          ]),
        );
        const dd = document.createElement('dd');
        dd.textContent = shortcut.does;
        list.append(dt, dd);
      }
      section.append(title, list);
      return section;
    }),
  );
  const toggle = () => (dialog.open ? dialog.close() : dialog.showModal());
  $('helpButton').addEventListener('click', toggle);
  $('helpClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  return {
    toggle,
    get isOpen() {
      return dialog.open;
    },
  };
}
