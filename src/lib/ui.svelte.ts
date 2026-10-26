// Fensterübergreifender Oberflächenzustand: Kontextmenü, „Gehe zu …“, Drag & Drop.
import type { Collection, Item } from './ytm';

export type MenuEntry =
  | 'sep'
  | {
      label: string;
      action?: () => unknown;
      disabled?: boolean;
      checked?: boolean;
      submenu?: MenuEntry[];
    };

class Ui {
  /** offenes Kontextmenü (Koordinaten in Fensterpunkten) */
  menu = $state<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  /** die Media Library soll diese Seite öffnen („Gehe zu Album/Künstler“) */
  navigate = $state<Collection | null>(null);
  /** aus der Media Library gezogene Einträge (Drag & Drop in die Playlist) */
  drag: Item[] | null = null;

  openMenu(e: MouseEvent, entries: MenuEntry[]) {
    e.preventDefault();
    e.stopPropagation();
    this.menu = { x: e.clientX, y: e.clientY, entries };
  }

  closeMenu() {
    this.menu = null;
  }

  /** Einträge eines offenen Menüs austauschen (z. B. wenn der Like-Status nachgeladen ist) */
  updateMenu(entries: MenuEntry[]) {
    if (this.menu) this.menu = { ...this.menu, entries };
  }

  goTo(c: Collection) {
    this.navigate = c;
  }
}

export const ui = new Ui();
