// Aktiver .wsz-Skin: laden, merken (localStorage), Farben anwenden.
import { invoke } from '@tauri-apps/api/core';
import { loadWsz, type Skin, type SkinImage } from './wsz';

const KEY = 'anyamp.skin.v1';

/** Standardfarben des eingebauten Skins (siehe skin.css / macos_vis.m) */
const PL_VARS = { normal: '--pl-normal', current: '--pl-current', normalBg: '--pl-bg', selectedBg: '--pl-selected-bg' } as const;

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

class SkinStore {
  current = $state<Skin | null>(null);
  error = $state('');

  /** Sprite-Ausschnitt als CSS-Hintergrund (Skin-Pixel) */
  bg(image: SkinImage, x: number, y: number) {
    const s = this.current?.images[image];
    return s ? `background:url("${s.url}") -${x}px -${y}px no-repeat;` : '';
  }

  has(image: SkinImage) {
    return !!this.current?.images[image];
  }

  /** gespeicherten Skin beim Start wiederherstellen */
  async restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (saved?.data) await this.#use(fromBase64(saved.data), saved.name, false);
    } catch {
      localStorage.removeItem(KEY);
    }
  }

  async load(file: File) {
    this.error = '';
    try {
      await this.#use(new Uint8Array(await file.arrayBuffer()), file.name, true);
    } catch (e) {
      this.error = `SKIN: ${(e as Error).message}`;
    }
  }

  reset() {
    this.#release();
    this.current = null;
    try {
      localStorage.removeItem(KEY);
    } catch {}
    this.#apply();
  }

  async #use(bytes: Uint8Array, name: string, save: boolean) {
    const skin = await loadWsz(bytes, name);
    this.#release();
    this.current = skin;
    if (save) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ name, data: toBase64(bytes) }));
      } catch {
        this.error = 'SKIN: ZU GROSS ZUM SPEICHERN (GILT NUR BIS ZUM NEUSTART)';
      }
    }
    this.#apply();
  }

  #release() {
    for (const s of Object.values(this.current?.images ?? {})) URL.revokeObjectURL(s.url);
    for (const url of Object.values(this.current?.tiles ?? {})) URL.revokeObjectURL(url);
  }

  /** Playlist-Farben als CSS-Variablen, Visualizer-Farben an das native Overlay */
  #apply() {
    const root = document.documentElement.style;
    const pl = this.current?.pl ?? {};
    for (const [key, cssVar] of Object.entries(PL_VARS)) {
      const v = pl[key as keyof typeof PL_VARS];
      if (v) root.setProperty(cssVar, v);
      else root.removeProperty(cssVar);
    }
    if (pl.font) root.setProperty('--pl-font', `"${pl.font}", Arial, Helvetica, sans-serif`);
    else root.removeProperty('--pl-font');
    const vis = this.current?.vis;
    const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    if (vis) {
      root.setProperty('--vis-bg', hex(vis[0]));
      root.setProperty('--vis-dots', hex(vis[1]));
    } else {
      root.removeProperty('--vis-bg');
      root.removeProperty('--vis-dots');
    }
    invoke('vis_colors', { colors: vis ?? [] }).catch(() => {});
  }
}

export const skin = new SkinStore();
