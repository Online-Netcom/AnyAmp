// AnyAmp-Bridge: läuft innerhalb von music.youtube.com (angemeldete Sitzung des Nutzers).
// Meldet Status an AnyAmp und führt Befehle aus. Wiedergabe ausschließlich über den
// offiziellen YT-Music-Player – nichts wird umgangen.
(() => {
  if (location.hostname !== 'music.youtube.com' || window.__anyamp) return;

  const send = (event) =>
    window.__TAURI_INTERNALS__?.invoke('ytm_event', { event }).catch((e) => console.warn('[anyamp]', e));
  const cfg = (key) => window.ytcfg?.get?.(key);
  const player = () => document.getElementById('movie_player');
  const cookie = (name) =>
    document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.slice(name.length + 1);

  // --- InnerTube im Kontext der angemeldeten Sitzung (wie die YTM-Seite selbst) ---

  async function sapisidHash() {
    const sapisid = cookie('SAPISID') || cookie('__Secure-3PAPISID');
    if (!sapisid) return null;
    const ts = Math.floor(Date.now() / 1000);
    const data = new TextEncoder().encode(`${ts} ${sapisid} ${location.origin}`);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
    return `SAPISIDHASH ${ts}_${[...hash].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  async function innertube(endpoint, body = {}, query = '') {
    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-AuthUser': String(cfg('SESSION_INDEX') ?? 0),
      'X-Origin': location.origin,
      'X-Youtube-Client-Name': String(cfg('INNERTUBE_CONTEXT_CLIENT_NAME') ?? 67),
      'X-Youtube-Client-Version': String(cfg('INNERTUBE_CLIENT_VERSION') ?? ''),
    };
    const auth = await sapisidHash();
    if (auth) headers.Authorization = auth;
    const visitor = cfg('VISITOR_DATA');
    if (visitor) headers['X-Goog-Visitor-Id'] = visitor;
    const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false${query}`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context: cfg('INNERTUBE_CONTEXT'), ...body }),
    });
    if (!res.ok) {
      const msg = await res.json().then((j) => j?.error?.message, () => null);
      throw new Error(`${endpoint}: HTTP ${res.status}${msg ? ` – ${msg}` : ''}`);
    }
    return res.json();
  }

  /** Folgeseite anfordern (lange Playlists); Token stammen aus `continuationOf`. */
  function more(endpoint, body, c) {
    return c.body
      ? innertube(endpoint, { ...body, continuation: c.token })
      : innertube(endpoint, body, `&ctoken=${encodeURIComponent(c.token)}&continuation=${encodeURIComponent(c.token)}&type=next`);
  }

  // --- Parser ---

  const runsText = (t) => t?.runs?.map((r) => r.text).join('') ?? t?.simpleText ?? '';
  const pageType = (e) =>
    e?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
  const isDuration = (p) => /^\d+(:\d{2})+$/.test(p);
  const thumb = (t) => {
    const list = t?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? t?.thumbnails ?? [];
    return list[0]?.url ?? null;
  };
  const artistsOf = (runs) =>
    (runs ?? []).filter((r) => pageType(r.navigationEndpoint) === 'MUSIC_PAGE_TYPE_ARTIST').map((r) => r.text);
  // „Song • “ / „Album • “ usw. am Anfang ungefilterter Treffer entfernen
  const KIND_WORDS = /^(Song|Video|Album|Single|EP|Playlist|Künstler|Artist|Episode|Podcast)$/i;
  // Untertitel ohne Aufrufe/Likes – nur Interpret, Album, Jahr
  const NOISE = /aufrufe|views|likes|wiedergaben|plays/i;
  const parts = (text) =>
    runsText(text).split(' • ').map((s) => s.trim()).filter((p) => p && !NOISE.test(p));

  /** Zeile einer Liste (Suche, Album-, Künstlerseite) → Track */
  function parseListItem(item) {
    const cols = (item.flexColumns ?? []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text);
    const videoId =
      item.playlistItemData?.videoId ??
      item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint
        ?.watchEndpoint?.videoId;
    if (!videoId) return null;
    const info = parts(cols[1]).filter((p) => !KIND_WORDS.test(p));
    const fixed = runsText(item.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
    const duration = isDuration(fixed) ? fixed : (info.findLast(isDuration) ?? '');
    const artists = artistsOf(cols[1]?.runs);
    return {
      videoId,
      title: runsText(cols[0]),
      artists: artists.length ? artists : info.slice(0, 1),
      subtitle: info.filter((p) => p !== duration).join(' • '),
      duration,
      thumbnail: thumb(item.thumbnail),
    };
  }

  const KINDS = {
    MUSIC_PAGE_TYPE_ALBUM: 'album',
    MUSIC_PAGE_TYPE_PLAYLIST: 'playlist',
    MUSIC_PAGE_TYPE_ARTIST: 'artist',
  };

  /** Album/Playlist/Künstler (Listenzeile oder Kachel) → Collection */
  function parseCollection(item, cols, endpoint) {
    const kind = KINDS[pageType(endpoint)];
    const browseId = endpoint?.browseEndpoint?.browseId;
    if (!kind || !browseId) return null;
    const info = parts(cols[1]);
    const year = info.find((p) => /^\d{4}$/.test(p)) ?? '';
    const type = KIND_WORDS.test(info[0] ?? '') ? info.shift() : '';
    const play = (item.overlay ?? item.thumbnailOverlay)?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer?.playNavigationEndpoint;
    return {
      kind,
      browseId,
      // Audio-Playlist (bei Alben OLAK5uy_…) – spart beim Öffnen einen Aufruf
      playlistId: play?.watchEndpoint?.playlistId ?? play?.watchPlaylistEndpoint?.playlistId ?? null,
      title: runsText(cols[0]),
      artists: artistsOf(cols[1]?.runs),
      subtitle: info.join(' • '),
      type, // „Album“, „Single“, „EP“ …
      year,
      thumbnail: thumb(item.thumbnail ?? item.thumbnailRenderer),
    };
  }

  /** Sammelt Tracks und/oder Collections in Dokumentreihenfolge. */
  function collect(node, want, out = []) {
    if (!node || typeof node !== 'object') return out;
    const row = node.musicResponsiveListItemRenderer;
    if (row) {
      const cols = (row.flexColumns ?? []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text);
      // Erst Collection prüfen: Album-Zeilen tragen im Play-Knopf auch die videoId des 1. Titels
      const item = parseCollection(row, cols, row.navigationEndpoint) ?? parseListItem(row);
      if (item && want(item)) out.push(item);
      return out;
    }
    const tile = node.musicTwoRowItemRenderer;
    if (tile) {
      const item = parseCollection(tile, [tile.title, tile.subtitle], tile.navigationEndpoint);
      if (item && want(item)) out.push(item);
      return out;
    }
    for (const v of Object.values(node)) collect(v, want, out);
    return out;
  }

  /** Eintrag der Warteschlange (`next`: Album, Playlist, Radio) → Track */
  function parsePanelVideo(v) {
    if (!v?.videoId || v.unplayableText) return null;
    const info = parts(v.longBylineText);
    const artists = artistsOf(v.longBylineText?.runs);
    return {
      videoId: v.videoId,
      title: runsText(v.title),
      artists: artists.length ? artists : info.slice(0, 1),
      subtitle: info.join(' • '),
      duration: runsText(v.lengthText),
      thumbnail: thumb(v.thumbnail),
    };
  }

  function collectPanel(node, out = []) {
    if (!node || typeof node !== 'object') return out;
    // Song/Musikvideo-Paar: nur die primäre Fassung nehmen
    const wrapped = node.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    const v = wrapped ?? node.playlistPanelVideoRenderer;
    if (v) {
      const t = parsePanelVideo(v);
      if (t) out.push(t);
      return out;
    }
    if (node.automixPreviewVideoRenderer) return out;
    for (const val of Object.values(node)) collectPanel(val, out);
    return out;
  }

  /** Erstes Weiterlesen-Token in `node` (alte und neue InnerTube-Form). */
  function continuationOf(node) {
    if (!node || typeof node !== 'object') return null;
    for (const key of ['nextContinuationData', 'nextRadioContinuationData']) {
      if (node[key]?.continuation) return { token: node[key].continuation, body: false };
    }
    if (node.continuationCommand?.token) return { token: node.continuationCommand.token, body: true };
    for (const v of Object.values(node)) {
      const c = continuationOf(v);
      if (c) return c;
    }
    return null;
  }

  /** Erster Wert zu einem der Schlüssel (Tiefensuche). */
  function find(node, keys) {
    if (!node || typeof node !== 'object') return null;
    for (const k of keys) if (node[k]) return node[k];
    for (const v of Object.values(node)) {
      const r = find(v, keys);
      if (r) return r;
    }
    return null;
  }
  const panelOf = (res) => find(res, ['playlistPanelContinuation', 'playlistPanelRenderer']);

  /** Warteschlange über `next` laden (inkl. Folgeseiten bis `limit`). */
  async function queue(body, limit) {
    body = { isAudioOnly: true, enablePersistentPlaylistPanel: true, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL', ...body };
    let panel = panelOf(await innertube('next', body));
    const seen = new Set();
    const tracks = [];
    const take = (page) => {
      const fresh = page.filter((t) => !seen.has(t.videoId) && seen.add(t.videoId));
      tracks.push(...fresh);
      return fresh.length;
    };
    take(collectPanel(panel?.contents));
    let c = continuationOf(panel?.continuations);
    while (c && tracks.length < limit) {
      panel = panelOf(await more('next', body, c).catch(() => null));
      if (!take(collectPanel(panel?.contents))) break; // nichts Neues → Ende
      c = continuationOf(panel?.continuations);
    }
    return tracks.slice(0, limit);
  }

  // --- Konto / Premium ---

  async function account() {
    const loggedIn = cfg('LOGGED_IN') === true;
    if (!loggedIn) return { loggedIn, premium: false, name: null };
    const [menu, guide] = await Promise.all([
      innertube('account/account_menu').catch(() => null),
      innertube('guide').catch(() => null),
    ]);
    const header = JSON.stringify(menu ?? {}).match(/"accountName":\{"runs":\[\{"text":"([^"]+)"/);
    // Heuristik (in Phase 0 zu verifizieren): Ohne Premium bietet YTM den
    // „Upgrade“-Eintrag (browseId SPunlimited) in der Navigation an.
    const premium = guide ? !JSON.stringify(guide).includes('"SPunlimited"') : null;
    return { loggedIn, premium, name: header?.[1] ?? null, debug: { guideHasUpgrade: premium === false } };
  }

  // Hinweis Visualizer: Web Audio am <video> des YTM-Players liefert unter WebKit nur
  // Nullwerte (MSE-Wiedergabe), und das versteckte Fenster wird auf 1 Hz gedrosselt.
  // Das Spektrum muss daher nativ entstehen – der Tonweg des Players bleibt unangetastet.

  // Audio-Format aus dem itag des aktuellen Streams (für die kbps/kHz-Anzeige)
  const ITAGS = { 139: [48, 44], 140: [128, 44], 141: [256, 44], 249: [50, 48], 250: [70, 48], 251: [160, 48], 774: [256, 48] };
  function format(p) {
    const m = String(p.getStatsForNerds?.()?.codecs ?? '').match(/\((\d+)\)/);
    const f = m && ITAGS[m[1]];
    return f ? { kbps: f[0], khz: f[1] } : { kbps: null, khz: null };
  }

  // --- Befehle ---

  // Der Track, den AnyAmp angefordert hat. Wechselt YTM selbst (Autoplay) oder endet
  // der Track, meldet die Bridge „ended“ und AnyAmp spielt aus der eigenen Playlist weiter.
  let requested = null, requestedAt = 0;

  // Vergleich ohne Groß-/Kleinschreibung und Akzente („tiesto“ = „Tiësto“)
  const norm = (t) =>
    t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const uniq = (items) => {
    const seen = new Set();
    return items.filter((i) => {
      const k = i.videoId ?? i.browseId;
      return !seen.has(k) && seen.add(k);
    });
  };

  /** Alle Teilbäume zu einem Schlüssel (Tiefensuche, Dokumentreihenfolge). */
  function findAll(node, key, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (node[key]) out.push(node[key]);
    else for (const v of Object.values(node)) findAll(v, key, out);
    return out;
  }

  /** Künstlerseite vollständig: Top-Songs, „Alle Songs“ und die komplette Diskografie. */
  async function artistPage(artistId) {
    const res = await innertube('browse', { browseId: artistId });
    const name = runsText(find(res, ['musicImmersiveHeaderRenderer', 'musicVisualHeaderRenderer'])?.title);
    const withArtist = (i) => (i.artists.length || !name ? i : { ...i, artists: [name] });

    const top = findAll(res, 'musicShelfRenderer')[0];
    const topSongs = top ? collect(top.contents, (i) => i.videoId) : [];
    const all = top?.bottomEndpoint?.browseEndpoint?.browseId;
    const allSongs = all?.startsWith('VL')
      ? [{ kind: 'playlist', browseId: all, playlistId: all.slice(2), title: `Alle Songs${name ? ` von ${name}` : ''}`, artists: [], subtitle: name, type: '', year: '', thumbnail: null }]
      : [];

    // „Alben“ und „Singles & EPs“: über den „Mehr“-Link der Diskografie komplett laden
    const albums = [];
    for (const shelf of findAll(res, 'musicCarouselShelfRenderer')) {
      const more = shelf.header?.musicCarouselShelfBasicHeaderRenderer?.moreContentButton?.buttonRenderer
        ?.navigationEndpoint?.browseEndpoint;
      let items = collect(shelf.contents, (i) => i.kind === 'album');
      if (pageType({ browseEndpoint: more }) === 'MUSIC_PAGE_TYPE_ARTIST_DISCOGRAPHY') {
        const page = await innertube('browse', { browseId: more.browseId, params: decodeURIComponent(more.params ?? '') })
          .catch(() => null);
        const full = page ? collect(page, (i) => i.kind === 'album') : [];
        if (full.length) items = full;
      }
      albums.push(...items.map(withArtist));
    }
    return { name, topSongs, allSongs, albums: uniq(albums) };
  }

  /** Genres und Stimmungen von YT Music (Seite „Stimmungen & Genres“). */
  async function genres() {
    const res = await innertube('browse', { browseId: 'FEmusic_moods_and_genres' });
    const seen = new Set();
    return findAll(res, 'musicNavigationButtonRenderer')
      .map((b) => ({ b, e: b.clickCommand?.browseEndpoint }))
      .filter(({ e }) => e?.params && !seen.has(e.params) && seen.add(e.params))
      .map(({ b, e }) => ({
        kind: 'genre', browseId: e.browseId, params: e.params, playlistId: null,
        title: runsText(b.buttonText), artists: [], subtitle: '', type: '', year: '', thumbnail: null,
      }));
  }

  // Suchfilter von YT Music (Songs / Alben / Playlists / Künstler)
  const SEARCH_PARAMS = {
    songs: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
    albums: 'EgWKAQIYAWoMEA4QChADEAQQCRAF',
    playlists: 'EgWKAQIoAWoMEA4QChADEAQQCRAF', // Community-Playlists
    curated: 'EgeKAQQoADgBagwQDhAKEAMQBBAJEAU=', // Playlists von YouTube Music selbst
    artists: 'EgWKAQIgAWoMEA4QChADEAQQCRAF',
  };

  const commands = {
    account,
    // Suche nach Kategorie (je ~20 Treffer; Folgeseiten lehnt die API für Web-Remix ab)
    async search({ query, kind = 'songs' }) {
      const run = async (k) => {
        const res = await innertube('search', { query, params: SEARCH_PARAMS[k] });
        const want = k === 'songs' ? (i) => i.videoId : (i) => i.kind === (k === 'curated' ? 'playlist' : k.slice(0, -1));
        return collect(res.contents, want);
      };
      if (kind === 'playlists') {
        // Kuratierte YT-Music-Playlists zuerst, danach die der Community
        const [curated, community] = await Promise.all([run('curated').catch(() => []), run('playlists')]);
        return uniq([...curated, ...community]);
      }
      if (kind === 'albums') {
        // Der Albenfilter liefert viel Beifang. Passt der Begriff auf einen Künstler,
        // kommt dessen komplette Diskografie zuerst.
        const [hits, artists] = await Promise.all([run('albums'), run('artists').catch(() => [])]);
        const artist = artists.find((a) => norm(a.title) === norm(query));
        if (!artist) return hits;
        const page = await artistPage(artist.browseId).catch(() => null);
        return uniq([...(page?.albums ?? []), ...hits]);
      }
      return run(kind);
    },
    genres,
    // Eigene Playlists aus der Bibliothek des Kontos (inkl. „Mag ich“)
    async library() {
      const res = await innertube('browse', { browseId: 'FEmusic_liked_playlists' });
      // Podcast-Listen (neue/gespeicherte Folgen) gehören nicht in einen Musikplayer
      return collect(res, (i) => i.kind === 'playlist' && !['RDPN', 'SE'].includes(i.playlistId));
    },
    // Album / Playlist / Künstler öffnen
    async open({ browseId, playlistId, params }) {
      if (browseId === 'FEmusic_moods_and_genres_category') {
        // Genre/Stimmung: die Playlists von YT Music (kuratierte zuerst, wie auf der Seite)
        const res = await innertube('browse', { browseId, params });
        return { items: uniq(collect(res, (i) => i.kind === 'playlist')) };
      }
      if (playlistId || browseId.startsWith('VL')) {
        return { items: await queue({ playlistId: playlistId ?? browseId.slice(2) }, 1000) };
      }
      if (browseId.startsWith('MPRE')) {
        const res = await innertube('browse', { browseId });
        // Album → zugehörige Audio-Playlist (OLAK5uy_…), dort stehen alle Interpreten pro Titel
        const id = JSON.stringify(res).match(/"playlistId":"(OLAK5uy_[\w-]+)"/)?.[1];
        const items = id ? await queue({ playlistId: id }, 500) : [];
        return { items: items.length ? items : collect(res, (i) => i.videoId) };
      }
      // Künstler: „Alle Songs“, Top-Songs, danach Alben und Singles komplett
      const page = await artistPage(browseId);
      return { items: [...page.allSongs, ...page.topSongs, ...page.albums] };
    },
    // Autoplay: „Radio“ zum Titel, wie YT Music es selbst anhängt
    radio: ({ videoId }) => queue({ videoId, playlistId: `RDAMVM${videoId}`, params: 'wAEB' }, 50),
    play({ videoId }) {
      requested = videoId;
      requestedAt = Date.now();
      const app = document.querySelector('ytmusic-app');
      app.dispatchEvent(
        new CustomEvent('yt-navigate', {
          bubbles: true,
          composed: true,
          detail: { endpoint: { watchEndpoint: { videoId } } },
        }),
      );
    },
    pause: () => player()?.pauseVideo(),
    stop() {
      player()?.pauseVideo();
      player()?.seekTo(0, true);
    },
    resume: () => player()?.playVideo(),
    seek: ({ seconds }) => player()?.seekTo(seconds, true),
    volume: ({ percent }) => player()?.setVolume(percent),
  };

  window.__anyamp = {
    async dispatch({ id, cmd, args }) {
      try {
        const fn = commands[cmd];
        if (!fn) throw new Error(`unbekannter Befehl: ${cmd}`);
        send({ type: 'result', id, ok: true, data: (await fn(args ?? {})) ?? null });
      } catch (e) {
        send({ type: 'result', id, ok: false, error: String(e?.message ?? e) });
      }
    },
  };

  // --- Statusmeldungen ---

  let last = '';
  let lowered = null;
  setInterval(() => {
    const p = player();
    if (!p?.getPlayerState) return;
    const data = p.getVideoData?.() ?? {};
    // Das Fenster ist unsichtbar: Video in kleinster Qualität dekodieren spart GPU/CPU.
    // Betrifft nur die Bildspur – die Audioqualität des Kontos bleibt unverändert.
    if (data.video_id && data.video_id !== lowered) {
      lowered = data.video_id;
      p.setPlaybackQualityRange?.('tiny', 'tiny');
      p.setPlaybackQuality?.('tiny');
    }
    const state = {
      type: 'state',
      videoId: data.video_id ?? null,
      title: data.title ?? '',
      author: data.author ?? '',
      state: p.getPlayerState(), // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering
      time: Math.floor(p.getCurrentTime?.() ?? 0),
      duration: Math.floor(p.getDuration?.() ?? 0),
      volume: p.getVolume?.() ?? 100,
      adShowing: p.classList.contains('ad-showing'),
      ...format(p),
    };
    if (requested && Date.now() - requestedAt > 4000) {
      const ended = state.state === 0;
      const hijacked = state.videoId && state.videoId !== requested;
      if (ended || hijacked) {
        if (hijacked) p.pauseVideo();
        send({ type: 'ended', videoId: requested });
        requested = null;
      }
    }
    const json = JSON.stringify(state);
    if (json !== last) {
      last = json;
      send(state);
    }
  }, 250);

  const announce = async () => send({ type: 'ready', account: await account().catch((e) => ({ error: String(e) })) });
  if (document.readyState === 'complete') announce();
  else window.addEventListener('load', announce, { once: true });
})();
