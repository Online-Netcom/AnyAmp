// Auto-Update über GitHub-Releases (Tauri-Updater, signiert). Prüft beim Start still im
// Hintergrund; installiert wird erst auf Wunsch (Optionsmenü), danach Neustart.
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

class Updater {
  available = $state<Update | null>(null);
  /** kurze Meldung für die Titelzeile („Suche …“, „Aktuell“, Fortschritt) */
  message = $state('');
  #clear = 0;

  #say(text: string, ms = 6000) {
    clearTimeout(this.#clear);
    this.message = text;
    if (ms) this.#clear = window.setTimeout(() => (this.message = ''), ms);
  }

  /** `quiet`: beim Start ohne Meldung, nur wenn es etwas Neues gibt */
  async check(quiet = false) {
    if (!quiet) this.#say('SUCHE NACH UPDATES ...', 0);
    try {
      this.available = await check();
      if (this.available) this.#say(`UPDATE ${this.available.version} VERFUEGBAR - MENUE O: INSTALLIEREN`, 15000);
      else if (!quiet) this.#say('ANYAMP! IST AKTUELL');
    } catch (e) {
      if (!quiet) this.#say(`UPDATE-PRUEFUNG FEHLGESCHLAGEN: ${(e as Error).message ?? e}`);
    }
  }

  async install() {
    const u = this.available;
    if (!u) return;
    let total = 0;
    let done = 0;
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') {
          done += ev.data.chunkLength;
          this.#say(`LADE UPDATE ${u.version} ... ${total ? Math.round((done / total) * 100) : '?'} %`, 0);
        } else this.#say('UPDATE INSTALLIERT - NEUSTART ...', 0);
      });
      await relaunch();
    } catch (e) {
      this.#say(`UPDATE FEHLGESCHLAGEN: ${(e as Error).message ?? e}`);
    }
  }
}

export const updater = new Updater();
