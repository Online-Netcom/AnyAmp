// AnyAmp! – nativer Spektrum-Visualizer (Core Animation) über dem AnyAmp-Fenster.
//
// Die Web-Oberfläche zeichnet nur das statische Punktraster; Balken und Spitzen liegen als
// Layer darüber. Rust liefert die fertigen Höhen (inkl. Falloff), ein Display-Link übernimmt
// sie im Takt des Bildschirms. Kein IPC, kein Neuzeichnen in WebKit – nur Layer-Frames.

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <os/lock.h>

#define BARS 19
#define SCOPE 76 // Oszilloskop: eine Spalte je Skin-Pixel

// VISCOLOR.TXT-Stil: Zeile 0 = oben (rot) … Zeile 15 = unten (grün)
static const uint32_t COLORS[16] = {
    0xef3110, 0xce2910, 0xd65a00, 0xd66600, 0xd67300, 0xc67b08, 0xdea518, 0xd6b521,
    0xbdde29, 0x94de21, 0x29ce10, 0x32be10, 0x39b510, 0x319c08, 0x299400, 0x188408,
};

static CGColorRef rgb(uint32_t c) {
    return CGColorCreateSRGB(((c >> 16) & 255) / 255.0, ((c >> 8) & 255) / 255.0, (c & 255) / 255.0, 1);
}

// Von Rust geschrieben, vom Display-Link gelesen
static os_unfair_lock g_lock = OS_UNFAIR_LOCK_INIT;
static uint8_t g_heights[BARS], g_peaks[BARS];
static uint8_t g_scope[SCOPE]; // Zeile 0 (oben) … 15 (unten)
static BOOL g_scopeMode = NO;
static BOOL g_dirty = NO;
static BOOL g_asleep = YES; // Display-Link pausiert → beim nächsten Update wecken

@interface AnyAmpVisView : NSView
@end

@implementation AnyAmpVisView {
    CALayer *_cols[BARS];
    CALayer *_peaks[BARS];
    CAGradientLayer *_fills[BARS];
    CADisplayLink *_link;
    CAShapeLayer *_scope;
    BOOL _scopeShown;
    uint8_t _h[BARS], _p[BARS];
    CGFloat _px;
    int _idle;
}

- (instancetype)init {
    if ((self = [super initWithFrame:NSZeroRect])) {
        self.wantsLayer = YES;
        self.layer.backgroundColor = CGColorGetConstantColor(kCGColorClear);
        _px = 1;
        // Harte Farbstufen: jede Zeile zweimal mit gleicher Position
        NSMutableArray *colors = [NSMutableArray array];
        NSMutableArray *locs = [NSMutableArray array];
        for (int row = 15; row >= 0; row--) { // Layer-Ursprung unten → unten beginnen
            CGColorRef c = rgb(COLORS[row]);
            [colors addObject:(__bridge id)c];
            [colors addObject:(__bridge id)c];
            CGColorRelease(c);
            int k = 15 - row;
            [locs addObject:@(k / 16.0)];
            [locs addObject:@((k + 1) / 16.0)];
        }
        CGColorRef peak = rgb(0x969696);
        for (int i = 0; i < BARS; i++) {
            _cols[i] = [CALayer layer];
            _cols[i].masksToBounds = YES;
            _cols[i].anchorPoint = CGPointZero;
            _fills[i] = [CAGradientLayer layer];
            _fills[i].colors = colors;
            _fills[i].locations = locs;
            _fills[i].startPoint = CGPointMake(0.5, 0);
            _fills[i].endPoint = CGPointMake(0.5, 1);
            _fills[i].anchorPoint = CGPointZero;
            [_cols[i] addSublayer:_fills[i]];
            [self.layer addSublayer:_cols[i]];
            _peaks[i] = [CALayer layer];
            _peaks[i].backgroundColor = peak;
            _peaks[i].anchorPoint = CGPointZero;
            _peaks[i].hidden = YES;
            [self.layer addSublayer:_peaks[i]];
        }
        CGColorRelease(peak);
        // Oszilloskop: Pixel-Spalten als ein Pfad (Winamp „Lines“-Stil), hellgrau wie VISCOLOR
        _scope = [CAShapeLayer layer];
        CGColorRef osc = rgb(0xd6d6de);
        _scope.fillColor = osc;
        CGColorRelease(osc);
        _scope.anchorPoint = CGPointZero;
        _scope.hidden = YES;
        [self.layer addSublayer:_scope];
        if ([self respondsToSelector:@selector(displayLinkWithTarget:selector:)]) {
            _link = [self displayLinkWithTarget:self selector:@selector(tick:)];
            [_link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
            _link.paused = YES;
        }
    }
    return self;
}

// Klicks gehen an die Web-Oberfläche darunter (Visualizer umschalten).
- (NSView *)hitTest:(NSPoint)point {
    return nil;
}

- (void)setPixel:(CGFloat)px {
    _px = px;
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    for (int i = 0; i < BARS; i++) {
        _fills[i].frame = CGRectMake(0, 0, 3 * px, 16 * px);
        _h[i] = 255; // neu setzen erzwingen
        _p[i] = 255;
    }
    [CATransaction commit];
    [self apply];
}

- (void)setFps:(int)fps {
    if (!_link) return;
    _link.preferredFrameRateRange = CAFrameRateRangeMake(fps, fps, fps);
}

- (void)wake {
    _idle = 0;
    if (_link) _link.paused = NO;
    else [self apply];
}

- (void)tick:(CADisplayLink *)link {
    if ([self apply] || ++_idle <= 30) return;
    // ~0,5 s ohne Änderung → schlafen, bis Rust wieder etwas liefert
    os_unfair_lock_lock(&g_lock);
    BOOL pending = g_dirty;
    if (!pending) g_asleep = YES;
    os_unfair_lock_unlock(&g_lock);
    if (!pending) link.paused = YES;
}

/// Übernimmt neue Höhen; YES, wenn sich etwas geändert hat.
- (BOOL)apply {
    uint8_t h[BARS], p[BARS], sc[SCOPE];
    os_unfair_lock_lock(&g_lock);
    BOOL dirty = g_dirty;
    BOOL scope = g_scopeMode;
    g_dirty = NO;
    memcpy(h, g_heights, BARS);
    memcpy(p, g_peaks, BARS);
    memcpy(sc, g_scope, SCOPE);
    os_unfair_lock_unlock(&g_lock);
    if (!dirty && _h[0] != 255) return NO;

    BOOL changed = NO;
    CGFloat px = _px;
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    if (scope != _scopeShown) {
        _scopeShown = scope;
        _scope.hidden = !scope;
        for (int i = 0; i < BARS; i++) {
            _cols[i].hidden = scope;
            _peaks[i].hidden = scope || _p[i] == 0;
        }
    }
    if (scope) {
        // senkrechte Verbindung zum Nachbarpunkt, damit eine durchgehende Linie entsteht
        CGMutablePathRef path = CGPathCreateMutable();
        for (int x = 0; x < SCOPE; x++) {
            int y = sc[x], prev = x ? sc[x - 1] : y;
            int lo = MIN(y, prev), hi = MAX(y, prev);
            if (hi - lo > 1) lo++, hi--; // nur die Lücke schließen
            else lo = hi = y;
            CGPathAddRect(path, NULL, CGRectMake(x * px, (15 - hi) * px, px, (hi - lo + 1) * px));
        }
        _scope.frame = self.bounds;
        _scope.path = path;
        CGPathRelease(path);
        [CATransaction commit];
        return YES;
    }
    for (int i = 0; i < BARS; i++) {
        if (h[i] != _h[i]) {
            _h[i] = h[i];
            _cols[i].frame = CGRectMake(i * 4 * px, 0, 3 * px, h[i] * px);
            changed = YES;
        }
        if (p[i] != _p[i]) {
            _p[i] = p[i];
            _peaks[i].hidden = p[i] == 0 || scope;
            if (p[i]) _peaks[i].frame = CGRectMake(i * 4 * px, (p[i] - 1) * px, 3 * px, px);
            changed = YES;
        }
    }
    [CATransaction commit];
    return changed;
}

@end

static AnyAmpVisView *g_view = nil;

/// Overlay im Fenster anlegen (Hauptthread).
void anyamp_vis_attach(void *ns_window) {
    NSWindow *window = (__bridge NSWindow *)ns_window;
    NSView *content = window.contentView;
    if (!content || g_view) return;
    g_view = [[AnyAmpVisView alloc] init];
    g_view.autoresizingMask = NSViewMinYMargin; // bleibt oben, wenn das Fenster wächst
    g_view.hidden = YES;
    [content addSubview:g_view positioned:NSWindowAbove relativeTo:nil];
}

/// Position in Punkten ab oben links, `px` = Punkte je Skin-Pixel; fps 0 = ausblenden.
void anyamp_vis_layout(double x, double y, double px, int fps) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!g_view) return;
        NSView *content = g_view.superview;
        CGFloat h = 16 * px;
        CGFloat top = content.isFlipped ? y : content.bounds.size.height - y - h;
        g_view.frame = NSMakeRect(x, top, 76 * px, h);
        g_view.hidden = fps == 0;
        [g_view setFps:fps];
        [g_view setPixel:px];
    });
}

static void wake_if_asleep(void);

/// Neue Balken- und Spitzenhöhen (0–16), aus beliebigem Thread.
void anyamp_vis_update(const uint8_t *heights, const uint8_t *peaks) {
    os_unfair_lock_lock(&g_lock);
    memcpy(g_heights, heights, BARS);
    memcpy(g_peaks, peaks, BARS);
    g_scopeMode = NO;
    g_dirty = YES;
    os_unfair_lock_unlock(&g_lock);
    wake_if_asleep();
}

/// Oszilloskop: 76 Zeilenwerte (0 = oben … 15 = unten), aus beliebigem Thread.
void anyamp_vis_scope(const uint8_t *rows) {
    os_unfair_lock_lock(&g_lock);
    memcpy(g_scope, rows, SCOPE);
    g_scopeMode = YES;
    g_dirty = YES;
    os_unfair_lock_unlock(&g_lock);
    wake_if_asleep();
}

static void wake_if_asleep(void) {
    os_unfair_lock_lock(&g_lock);
    BOOL wake = g_asleep;
    g_asleep = NO;
    os_unfair_lock_unlock(&g_lock);
    if (wake) dispatch_async(dispatch_get_main_queue(), ^{
        [g_view wake];
    });
}
