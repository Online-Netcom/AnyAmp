fn main() {
    // Native Audio-Abgriffe für den Visualizer
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=native/macos_tap.m");
        cc::Build::new()
            .file("native/macos_tap.m")
            .flag("-fobjc-arc")
            .flag("-Wno-unguarded-availability-new")
            .flag("-Wno-unused-parameter")
            .compile("anyamp_tap");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }

    // Eigene Commands explizit deklarieren, damit sie per Capability freigegeben
    // werden können – nötig für die Bridge auf der Remote-Seite music.youtube.com.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "ytm_event",
            "ytm_call",
            "ytm_login",
            "ytm_set_visible",
            "ytm_reload",
            "vis_rate",
        ]),
    ))
    .expect("failed to run tauri-build");
}
