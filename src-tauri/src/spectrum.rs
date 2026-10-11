//! Echtes Spektrum für den Winamp-Visualizer.
//!
//! Der YTM-Player spielt in der WebView über MSE – Web Audio sieht dort nur Stille.
//! Deshalb hört AnyAmp nativ mit (macOS: Core Audio Process Tap, nur eigene App),
//! rechnet eine FFT und schickt 19 Balken (0–16) als `vis`-Event an die Oberfläche.

use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use rustfft::{num_complex::Complex, FftPlanner};
use serde_json::json;
use tauri::{AppHandle, Emitter};

pub const BARS: usize = 19;
const FFT_SIZE: usize = 2048;

/// Bildrate des Visualizers (Winamp: „Refresh rate“); 0 = aus.
static FPS: AtomicU32 = AtomicU32::new(60);

pub fn set_fps(fps: u32) {
    FPS.store(fps.min(120), Ordering::Relaxed);
}

#[derive(Default)]
struct Samples {
    buf: VecDeque<f32>,
    rate: f64,
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

    pub fn bars(&mut self, samples: &[f32], rate: f64) -> [u8; BARS] {
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
            let db = 20.0 * (peak / (FFT_SIZE as f32 / 4.0)).max(1e-9).log10();
            // -60 dB … 0 dB → 0 … 16, Höhen leicht anheben (wie Winamp)
            let tilt = b as f32 * 0.35;
            *slot = (((db + 60.0 + tilt) / 60.0) * 16.0).clamp(0.0, 16.0) as u8;
        }
        out
    }
}

#[cfg(target_os = "macos")]
mod tap {
    use std::ffi::c_void;

    pub type SamplesCb = extern "C" fn(*mut c_void, *const f32, u32, f64);

    unsafe extern "C" {
        pub fn anyamp_tap_init(cb: SamplesCb, ctx: *mut c_void);
        pub fn anyamp_tap_refresh(count: *mut u32) -> i32;
    }
}

#[cfg(target_os = "macos")]
extern "C" fn on_samples(ctx: *mut std::ffi::c_void, mono: *const f32, frames: u32, rate: f64) {
    // Läuft im Echtzeit-Audiothread: nie blockieren.
    let shared = unsafe { &*(ctx as *const Mutex<Samples>) };
    let Ok(mut s) = shared.try_lock() else { return };
    let data = unsafe { std::slice::from_raw_parts(mono, frames as usize) };
    s.rate = rate;
    s.buf.extend(data);
    let excess = s.buf.len().saturating_sub(FFT_SIZE);
    s.buf.drain(..excess);
}

/// Startet Abgriff und Analyse im Hintergrund.
pub fn start(app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let shared: &'static Mutex<Samples> = Box::leak(Box::default());
        unsafe { tap::anyamp_tap_init(on_samples, shared as *const _ as *mut _) };

        // Prozesse der App ändern sich (WebKit startet Dienste nach Bedarf) → regelmäßig abgleichen.
        std::thread::spawn(|| {
            let mut last = (0, 0);
            loop {
                let mut count = 0;
                let status = unsafe { tap::anyamp_tap_refresh(&mut count) };
                if (status, count) != last {
                    eprintln!("[spectrum] tap status={status} prozesse={count}");
                    last = (status, count);
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        });

        std::thread::spawn(move || {
            let mut analyzer = Analyzer::new();
            let mut frame = vec![0f32; FFT_SIZE];
            let mut was_silent = true;
            let mut reported = false;
            loop {
                let fps = FPS.load(Ordering::Relaxed);
                if fps == 0 {
                    std::thread::sleep(Duration::from_millis(200));
                    continue;
                }
                std::thread::sleep(Duration::from_secs_f64(1.0 / fps as f64));
                let rate = {
                    let s = shared.lock().unwrap();
                    if s.buf.len() < FFT_SIZE {
                        continue;
                    }
                    for (dst, src) in frame.iter_mut().zip(&s.buf) {
                        *dst = *src;
                    }
                    s.rate
                };
                let bars = analyzer.bars(&frame, rate);
                let silent = bars.iter().all(|&b| b == 0);
                if !reported && !silent {
                    eprintln!("[spectrum] Signal erkannt ({rate} Hz)");
                    reported = true;
                }
                if !(silent && was_silent) {
                    let _ = app.emit_to("main", "ytm", json!({ "type": "vis", "bars": bars }));
                }
                was_silent = silent;
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app; // Windows (WASAPI-Loopback) / Android (Visualizer-API) folgen.
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
        assert_eq!(Analyzer::new().bars(&vec![0.0; FFT_SIZE], 48000.0), [0; BARS]);
    }

    #[test]
    fn tiefer_ton_landet_links_hoher_rechts() {
        let mut a = Analyzer::new();
        let low = a.bars(&sine(60.0, 48000.0, 0.8), 48000.0);
        let high = a.bars(&sine(8000.0, 48000.0, 0.8), 48000.0);
        let argmax = |b: [u8; BARS]| (0..BARS).max_by_key(|&i| b[i]).unwrap();
        assert!(argmax(low) <= 2, "{low:?}");
        assert!(argmax(high) >= 14, "{high:?}");
        assert!(low[argmax(low)] >= 14, "laut genug: {low:?}");
    }
}
