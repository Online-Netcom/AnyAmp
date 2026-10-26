// Klassische Winamp-2-Skins (.wsz = ZIP mit BMPs und Textdateien) einlesen.
// Liefert pro Bitmap eine Bild-URL samt Größe, die Playlist-Farben (PLEDIT.TXT) und die
// 24 Visualizer-Farben (VISCOLOR.TXT). Fehlende Dateien bleiben leer – die Oberfläche
// zeichnet das betroffene Element dann selbst.
import { unzipSync } from 'fflate';

export interface Sprite {
  url: string;
  width: number;
  height: number;
}

export interface PlColors {
  normal?: string;
  current?: string;
  normalBg?: string;
  selectedBg?: string;
  font?: string;
}

export interface Skin {
  name: string;
  images: Partial<Record<SkinImage, Sprite>>;
  /** aus PLEDIT.BMP ausgeschnittene Kacheln (wiederholbar), siehe TILES */
  tiles: Partial<Record<keyof typeof TILES, string>>;
  pl: PlColors;
  /** 24 Farben als 0xRRGGBB: 0 Hintergrund, 1 Punkte, 2–17 Spektrum (oben→unten), 18–22 Oszilloskop, 23 Spitzen */
  vis: number[] | null;
}

export const IMAGES = [
  'main', 'titlebar', 'cbuttons', 'numbers', 'nums_ex', 'text', 'playpaus', 'monoster',
  'posbar', 'volume', 'balance', 'shufrep', 'pledit',
] as const;
export type SkinImage = (typeof IMAGES)[number];

/** Kachelbereiche in PLEDIT.BMP: [x, y, Breite, Höhe] */
export const TILES = {
  top: [127, 0, 25, 20],
  topInactive: [127, 21, 25, 20],
  left: [0, 42, 12, 29],
  right: [31, 42, 20, 29],
  bottom: [179, 0, 25, 38],
} as const;

const basename = (path: string) => path.split(/[\\/]/).pop()!.toLowerCase();

async function sprite(bytes: Uint8Array): Promise<Sprite & { img: HTMLImageElement }> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/bmp' }));
  const img = new Image();
  img.src = url;
  await img.decode();
  return { url, width: img.naturalWidth, height: img.naturalHeight, img };
}

/** Ausschnitt als eigenes Bild (für wiederholte Kacheln) */
async function crop(img: HTMLImageElement, [x, y, w, h]: readonly number[]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(img, x, y, w, h, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  return blob ? URL.createObjectURL(blob) : '';
}

/** „Normal=#00FF00“ aus PLEDIT.TXT */
function parsePledit(text: string): PlColors {
  const get = (key: string) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'im'))?.[1];
  const color = (v?: string) => (v && /^#?[0-9a-f]{6}$/i.test(v) ? (v.startsWith('#') ? v : `#${v}`) : undefined);
  return {
    normal: color(get('Normal')),
    current: color(get('Current')),
    normalBg: color(get('NormalBG')),
    selectedBg: color(get('SelectedBG')),
    font: get('Font'),
  };
}

/** „24,33,41, // Hintergrund“ je Zeile aus VISCOLOR.TXT */
function parseViscolor(text: string): number[] | null {
  const colors: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) colors.push((+m[1] << 16) | (+m[2] << 8) | +m[3]);
  }
  return colors.length >= 24 ? colors.slice(0, 24) : null;
}

export async function loadWsz(bytes: Uint8Array, name: string): Promise<Skin> {
  const files = unzipSync(bytes);
  const byName = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(files)) if (data.length) byName.set(basename(path), data);

  const images: Skin['images'] = {};
  const tiles: Skin['tiles'] = {};
  await Promise.all(
    IMAGES.map(async (key) => {
      const data = byName.get(`${key}.bmp`) ?? byName.get(`${key}.png`);
      if (!data) return;
      const s = await sprite(data).catch(() => undefined);
      if (!s) return;
      images[key] = { url: s.url, width: s.width, height: s.height };
      if (key === 'pledit') {
        for (const [name, rect] of Object.entries(TILES)) tiles[name as keyof typeof TILES] = await crop(s.img, rect);
      }
    }),
  );
  if (!images.main || !images.cbuttons || !images.titlebar) {
    throw new Error('Kein klassischer Winamp-2-Skin (MAIN/CBUTTONS/TITLEBAR fehlen)');
  }
  const text = (file: string) => {
    const data = byName.get(file);
    return data ? new TextDecoder('latin1').decode(data) : '';
  };
  return {
    name: name.replace(/\.(wsz|zip)$/i, ''),
    images,
    tiles,
    pl: parsePledit(text('pledit.txt')),
    vis: parseViscolor(text('viscolor.txt')),
  };
}
