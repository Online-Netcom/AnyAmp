//! Echtes Spektrum für den Winamp-Visualizer.
//!
//! Der YTM-Player spielt in der WebView über MSE – Web Audio sieht dort nur Stille.
//! Deshalb hört AnyAmp nativ mit (macOS: Core Audio Process Tap, nur eigene App),
//! rechnet eine FFT mit Winamp-Falloff und zeichnet 19 Balken (0–16) nativ als
//! Core-Animation-Overlay über die Oberfläche – ohne Umweg über die WebView.

use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use rustfft::{num_complex::Complex, FftPlanner};

pub const BARS: usize = 19;
/// Oszilloskop: eine Spalte je Skin-Pixel der 76 px breiten Fläche
pub const SCOPE: usize = 76;
/// So viele Samples zeigt das Oszilloskop (~11 ms bei 48 kHz, ähnlich Winamp)
const SCOPE_SAMPLES: usize = 512;
const FFT_SIZE: usize = 2048;

/// Bildrate des Visualizers (Winamp: „Refresh rate“); 0 = aus.
static FPS: AtomicU32 = AtomicU32::new(60);
/// 0 = Spektrum, 1 = Oszilloskop
static MODE: AtomicU32 = AtomicU32::new(0);
/// Player-Lautstärke in Prozent. Der Abgriff liegt hinter dem Lautstärkeregler –
/// wie bei Winamp soll das Spektrum aber das Signal selbst zeigen, nicht die Lautstärke.
static VOLUME: AtomicU32 = AtomicU32::new(100);

pub fn set_volume(percent: u32) {
    VOLUME.store(percent.min(100), Ordering::Relaxed);
}

/// Ausgleich in dB für die Player-Lautstärke (linear wie HTML-Media `volume`), höchstens +40 dB.
fn volume_gain_db() -> f32 {
    let v = VOLUME.load(Ordering::Relaxed);
    if v == 0 { 0.0 } else { (-20.0 * (v as f32 / 100.0).log10()).min(40.0) }
}

/// Bildrate und Lage des Visualizers (Punkte ab oben links, `px` = Punkte je Skin-Pixel).
pub fn configure(fps: u32, scope: bool, x: f64, y: f64, px: f64) {
    let fps = fps.min(120);
    FPS.store(fps, Ordering::Relaxed);
    MODE.store(scope as u32, Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    unsafe {
        native::anyamp_vis_layout(x, y, px, fps as i32)
    };
    #[cfg(not(target_os = "macos"))]
    let _ = (x, y, px);
}

/// Overlay an das AnyAmp-Fenster hängen (Hauptthread).
pub fn attach(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(ns) = window.ns_window() {
        unsafe { native::anyamp_vis_attach(ns) };
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

const BAR_FALL: f32 = 40.0; // Skin-Pixel pro Sekunde
const PEAK_HOLD: f32 = 0.4; // Sekunden
const PEAK_FALL: f32 = 14.0; // Skin-Pixel pro Sekunde

/// Oszilloskop-Zeilen (0 = oben … 15 = unten) aus den letzten Samples, verstärkt um `gain` (linear).
pub fn scope_rows(samples: &[f32], gain: f32) -> [u8; SCOPE] {
    let mut rows = [8u8; SCOPE];
    if samples.is_empty() {
        return rows;
    }
    for (x, row) in rows.iter_mut().enumerate() {
        let s = samples[x * samples.len() / SCOPE] * gain;
        *row = (8.0 - s * 8.0).round().clamp(0.0, 15.0) as u8;
    }
    rows
}

/// Winamp-Falloff: Balken steigen sofort und fallen gleichmäßig, Spitzen halten kurz.
#[derive(Default)]
pub struct Falloff {
    level: [f32; BARS],
    peak: [f32; BARS],
    hold: [f32; BARS],
}

impl Falloff {
    /// Ein Zeitschritt; liefert sichtbare Balken- und Spitzenhöhen (0 = keine Spitze).
    pub fn step(&mut self, target: &[u8; BARS], dt: f32) -> ([u8; BARS], [u8; BARS]) {
        let (mut h, mut p) = ([0u8; BARS], [0u8; BARS]);
        for i in 0..BARS {
            let t = target[i] as f32;
            self.level[i] = if t >= self.level[i] { t } else { (self.level[i] - BAR_FALL * dt).max(t) };
            if self.level[i] >= self.peak[i] {
                self.peak[i] = self.level[i];
                self.hold[i] = PEAK_HOLD;
            } else if self.hold[i] > 0.0 {
                self.hold[i] -= dt;
            } else {
                self.peak[i] = (self.peak[i] - PEAK_FALL * dt).max(0.0);
            }
            h[i] = self.level[i].round() as u8;
            p[i] = if self.peak[i] >= 1.0 { self.peak[i].ceil() as u8 } else { 0 };
        }
        (h, p)
    }
}

#[derive(Default)]
struct Samples {
    buf: VecDeque<f32>,
    rate: f64,
    /// seit der letzten Analyse eingetroffen – bleibt es aus, ist Pause/Stille
    fresh: usize,
}

/// Berechnet die Winamp-Balken (0–16) aus `FFT_SIZE` Mono-Samples.
pub struct Analyzer {
    fft: Arc<dyn rustfft::Fft<f32>>,
    window: Vec<f32>,
    scratch: Vec<Complex<f32>>,
}

impl Analyzer {
    pub fn new() -> Self {
        let window = (0..FFT_SIZE)
            .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / FFT_SIZE as f32).cos())
            .collect();
        Self {
            fft: FftPlanner::new().plan_fft_forward(FFT_SIZE),
            window,
            scratch: vec![Complex::default(); FFT_SIZE],
        }
    }

    /// `gain_db` gleicht eine abgesenkte Lautstärke aus.
    pub fn bars(&mut self, samples: &[f32], rate: f64, gain_db: f32) -> [u8; BARS] {
        debug_assert_eq!(samples.len(), FFT_SIZE);
        for (i, (s, w)) in samples.iter().zip(&self.window).enumerate() {
            self.scratch[i] = Complex::new(s * w, 0.0);
        }
        self.fft.process(&mut self.scratch);

        let bin_hz = rate as f32 / FFT_SIZE as f32;
        let (lo, hi) = (40.0f32, 16_000.0f32.min(rate as f32 / 2.0));
        let mut out = [0u8; BARS];
        for (b, slot) in out.iter_mut().enumerate() {
            // logarithmisch verteilte Bänder
            let f0 = lo * (hi / lo).powf(b as f32 / BARS as f32);
            let f1 = lo * (hi / lo).powf((b + 1) as f32 / BARS as f32);
            let i0 = ((f0 / bin_hz) as usize).max(1);
            let i1 = ((f1 / bin_hz) as usize).max(i0 + 1).min(FFT_SIZE / 2);
            let peak = self.scratch[i0..i1].iter().map(|c| c.norm()).fold(0.0f32, f32::max);
            // Normierung: Vollaussteuerung eines Sinus ≈ FFT_SIZE/4 (Hann-Fenster)
            let db = 20.0 * (peak / (FFT_SIZE as f32 / 4.0)).max(1e-9).log10() + gain_db;
            // -60 dB … 0 dB → 0 … 16, Höhen leicht anheben (wie Winamp)
            let tilt = b as f32 * 0.35;
            *slot = (((db + 60.0 + tilt) / 60.0) * 16.0).clamp(0.0, 16.0) as u8;
        }
        out
    }
}

#[cfg(target_os = "macos")]
mod native {
    use std::ffi::c_void;

    pub type SamplesCb = extern "C" fn(*mut c_void, *const f32, u32, f64);

    unsafe extern "C" {
        pub fn anyamp_tap_init(cb: SamplesCb, ctx: *mut c_void);
        pub fn anyamp_tap_refresh(count: *mut u32) -> i32;
        pub fn anyamp_vis_attach(ns_window: *mut c_void);
        pub fn anyamp_vis_layout(x: f64, y: f64, px: f64, fps: i32);
        pub fn anyamp_vis_update(heights: *const u8, peaks: *const u8);
        pub fn anyamp_vis_scope(rows: *const u8);
    }
}

#[cfg(target_os = "macos")]
extern "C" fn on_samples(ctx: *mut std::ffi::c_void, mono: *const f32, frames: u32, rate: f64) {
    // Läuft im Echtzeit-Audiothread: nie blockieren.
    let shared = unsafe { &*(ctx as *const Mutex<Samples>) };
    let Ok(mut s) = shared.try_lock() else { return };
    let data = unsafe { std::slice::from_raw_parts(mono, frames as usize) };
    s.rate = rate;
    s.fresh += data.len();
    s.buf.extend(data);
    let excess = s.buf.len().saturating_sub(FFT_SIZE);
    s.buf.drain(..excess);
}

/// Startet Abgriff und Analyse im Hintergrund.
pub fn start() {
    #[cfg(target_os = "macos")]
    {
        let shared: &'static Mutex<Samples> = Box::leak(Box::default());
        unsafe { native::anyamp_tap_init(on_samples, shared as *const _ as *mut _) };

        // Prozesse der App ändern sich (WebKit startet Dienste nach Bedarf) → regelmäßig abgleichen.
        std::thread::spawn(|| {
            let mut last = (0, 0);
            loop {
                let mut count = 0;
                let status = unsafe { native::anyamp_tap_refresh(&mut count) };
                if (status, count) != last {
                    eprintln!("[spectrum] tap status={status} prozesse={count}");
                    last = (status, count);
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        });

        std::thread::spawn(move || {
            let mut analyzer = Analyzer::new();
            let mut falloff = Falloff::default();
            let mut frame = vec![0f32; FFT_SIZE];
            let mut shown = ([0u8; BARS], [0u8; BARS]);
            let mut shown_scope = [255u8; SCOPE];
            let mut starved = 0u32;
            let mut reported = false;
            let mut last = std::time::Instant::now();
            loop {
                let fps = FPS.load(Ordering::Relaxed);
                if fps == 0 {
                    std::thread::sleep(Duration::from_millis(200));
                    continue;
                }
                std::thread::sleep(Duration::from_secs_f64(1.0 / fps as f64));
                let now = std::time::Instant::now();
                let dt = (now - last).as_secs_f32().min(0.1);
                last = now;

                // Ohne neue Samples (Pause, Stopp) keine alten Daten wiederholen → Balken fallen
                let scope = MODE.load(Ordering::Relaxed) == 1;
                let input = {
                    let mut s = shared.lock().unwrap();
                    starved = if s.fresh == 0 { starved + 1 } else { 0 };
                    s.fresh = 0;
                    if s.buf.len() < FFT_SIZE || starved > 3 {
                        None
                    } else {
                        for (dst, src) in frame.iter_mut().zip(&s.buf) {
                            *dst = *src;
                        }
                        Some(s.rate)
                    }
                };
                let gain_db = volume_gain_db();

                if scope {
                    let rows = match input {
                        Some(_) => scope_rows(&frame[FFT_SIZE - SCOPE_SAMPLES..], 10f32.powf(gain_db / 20.0)),
                        None => [8; SCOPE],
                    };
                    if rows != shown_scope {
                        shown_scope = rows;
                        unsafe { native::anyamp_vis_scope(rows.as_ptr()) };
                    }
                    shown = ([255; BARS], [255; BARS]); // beim Zurückschalten neu zeichnen
                    continue;
                }
                shown_scope = [255; SCOPE];

                let target = match input {
                    Some(rate) => {
                        let bars = analyzer.bars(&frame, rate, gain_db);
                        if !reported && bars.iter().any(|&b| b > 0) {
                            eprintln!("[spectrum] Signal erkannt ({rate} Hz)");
                            reported = true;
                        }
                        bars
                    }
                    None => [0; BARS],
                };
                let next = falloff.step(&target, dt);
                if next != shown {
                    shown = next;
                    unsafe { native::anyamp_vis_update(shown.0.as_ptr(), shown.1.as_ptr()) };
                }
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, rate: f32, amp: f32) -> Vec<f32> {
        (0..FFT_SIZE)
            .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / rate).sin())
            .collect()
    }

    #[test]
    fn stille_ergibt_null() {
        assert_eq!(Analyzer::new().bars(&vec![0.0; FFT_SIZE], 48000.0, 20.0), [0; BARS]);
    }

    #[test]
    fn tiefer_ton_landet_links_hoher_rechts() {
        let mut a = Analyzer::new();
        let low = a.bars(&sine(60.0, 48000.0, 0.8), 48000.0, 0.0);
        let high = a.bars(&sine(8000.0, 48000.0, 0.8), 48000.0, 0.0);
        let argmax = |b: [u8; BARS]| (0..BARS).max_by_key(|&i| b[i]).unwrap();
        assert!(argmax(low) <= 2, "{low:?}");
        assert!(argmax(high) >= 14, "{high:?}");
        assert!(low[argmax(low)] >= 14, "laut genug: {low:?}");
    }

    #[test]
    fn leise_lautstaerke_wird_ausgeglichen() {
        let mut a = Analyzer::new();
        let full = a.bars(&sine(440.0, 48000.0, 0.5), 48000.0, 0.0);
        // Lautstärke 25 %: Signal ein Viertel so stark, Ausgleich +12 dB
        let quiet = a.bars(&sine(440.0, 48000.0, 0.125), 48000.0, -20.0 * 0.25f32.log10());
        assert_eq!(full, quiet);
    }

    #[test]
    fn oszilloskop_mittellinie_und_ausschlag() {
        assert_eq!(scope_rows(&[0.0; 512], 1.0), [8; SCOPE]);
        let rows = scope_rows(&sine(480.0, 48000.0, 1.0)[..512], 1.0);
        assert!(rows.iter().any(|&r| r == 0) && rows.iter().any(|&r| r == 15), "{rows:?}");
    }

    #[test]
    fn falloff_steigt_sofort_und_faellt_gleichmaessig() {
        let mut f = Falloff::default();
        let mut t = [0u8; BARS];
        t[0] = 16;
        assert_eq!(f.step(&t, 0.016).0[0], 16);
        // 0,1 s Stille: 40 px/s → 4 px tiefer, Spitze hält noch oben
        let (h, p) = f.step(&[0; BARS], 0.1);
        assert_eq!(h[0], 12);
        assert_eq!(p[0], 16);
        // nach ausreichend Zeit ist alles unten
        for _ in 0..100 {
            f.step(&[0; BARS], 0.05);
        }
        assert_eq!(f.step(&[0; BARS], 0.05), ([0; BARS], [0; BARS]));
    }
}
