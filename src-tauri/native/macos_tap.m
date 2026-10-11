// AnyAmp! – Audio-Abgriff für den Visualizer (macOS 14.2+, Core Audio Process Tap).
//
// Tappt ausschließlich die Audioausgabe der eigenen App (inkl. der WebKit-Prozesse,
// die für AnyAmp abspielen), mischt auf Mono und reicht die Samples an Rust weiter.
// Der Ton selbst bleibt unverändert (CATapUnmuted) – es wird nur mitgehört.

#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <CoreAudio/CATapDescription.h>
#include <unistd.h>

// libSystem: liefert den „verantwortlichen“ Prozess (App) zu einem XPC-Dienst wie WebKit.GPU.
extern pid_t responsibility_get_pid_responsible_for_pid(pid_t pid);

typedef void (*anyamp_samples_cb)(void *ctx, const float *mono, uint32_t frames, double sample_rate);

static anyamp_samples_cb g_cb = NULL;
static void *g_ctx = NULL;
static AudioObjectID g_tap = kAudioObjectUnknown;
static AudioObjectID g_agg = kAudioObjectUnknown;
static AudioDeviceIOProcID g_proc = NULL;
static NSArray<NSNumber *> *g_procs = nil;
static double g_rate = 48000;

// Process Taps gibt es ab macOS 14.2. Bewusst kein @available: das bräuchte
// __isPlatformVersionAtLeast aus compiler-rt, das im Release-Link (LTO) fehlt.
static BOOL taps_supported(void) {
    NSOperatingSystemVersion v = {14, 2, 0};
    return [[NSProcessInfo processInfo] isOperatingSystemAtLeastVersion:v];
}

#define MAX_FRAMES 8192
static float g_mono[MAX_FRAMES];

static OSStatus io_proc(AudioObjectID device, const AudioTimeStamp *now, const AudioBufferList *in,
                        const AudioTimeStamp *in_time, AudioBufferList *out, const AudioTimeStamp *out_time,
                        void *client) {
    if (!g_cb || !in || in->mNumberBuffers == 0) return noErr;
    const AudioBuffer *b0 = &in->mBuffers[0];
    if (!b0->mData) return noErr;
    UInt32 frames;
    if (in->mNumberBuffers == 1) {
        // interleaved
        UInt32 ch = b0->mNumberChannels ? b0->mNumberChannels : 1;
        frames = MIN(b0->mDataByteSize / (UInt32)(sizeof(float) * ch), MAX_FRAMES);
        const float *s = b0->mData;
        for (UInt32 i = 0; i < frames; i++) {
            float sum = 0;
            for (UInt32 c = 0; c < ch; c++) sum += s[i * ch + c];
            g_mono[i] = sum / ch;
        }
    } else {
        // ein Puffer pro Kanal
        UInt32 n = in->mNumberBuffers;
        frames = MIN(b0->mDataByteSize / (UInt32)sizeof(float), MAX_FRAMES);
        for (UInt32 i = 0; i < frames; i++) {
            float sum = 0;
            for (UInt32 c = 0; c < n; c++) {
                const float *s = in->mBuffers[c].mData;
                if (s) sum += s[i];
            }
            g_mono[i] = sum / n;
        }
    }
    g_cb(g_ctx, g_mono, frames, g_rate);
    return noErr;
}

static AudioObjectPropertyAddress addr(AudioObjectPropertySelector sel) {
    return (AudioObjectPropertyAddress){sel, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
}

static pid_t responsible(pid_t pid) {
    pid_t r = responsibility_get_pid_responsible_for_pid(pid);
    return r > 0 ? r : pid;
}

/// Prozess-Objekte der Audio-HAL, die zu dieser App gehören (eigener Prozess + WebKit-Dienste).
static NSArray<NSNumber *> *own_processes(void) {
    AudioObjectPropertyAddress a = addr(kAudioHardwarePropertyProcessObjectList);
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &a, 0, NULL, &size) || size == 0) return @[];
    UInt32 n = size / sizeof(AudioObjectID);
    AudioObjectID *ids = calloc(n, sizeof(AudioObjectID));
    NSMutableArray *out = [NSMutableArray array];
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, NULL, &size, ids) == noErr) {
        pid_t me = getpid(), owner = responsible(me);
        AudioObjectPropertyAddress pa = addr(kAudioProcessPropertyPID);
        for (UInt32 i = 0; i < n; i++) {
            pid_t pid = 0;
            UInt32 s = sizeof(pid);
            if (AudioObjectGetPropertyData(ids[i], &pa, 0, NULL, &s, &pid) == noErr &&
                (pid == me || responsible(pid) == owner))
                [out addObject:@(ids[i])];
        }
    }
    free(ids);
    return out;
}

static NSString *default_output_uid(void) {
    AudioObjectID dev = kAudioObjectUnknown;
    UInt32 s = sizeof(dev);
    AudioObjectPropertyAddress a = addr(kAudioHardwarePropertyDefaultSystemOutputDevice);
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, NULL, &s, &dev)) return nil;
    CFStringRef uid = NULL;
    s = sizeof(uid);
    a = addr(kAudioDevicePropertyDeviceUID);
    if (AudioObjectGetPropertyData(dev, &a, 0, NULL, &s, &uid)) return nil;
    return CFBridgingRelease(uid);
}

static void teardown(void) {
    if (g_agg != kAudioObjectUnknown) {
        if (g_proc) {
            AudioDeviceStop(g_agg, g_proc);
            AudioDeviceDestroyIOProcID(g_agg, g_proc);
            g_proc = NULL;
        }
        AudioHardwareDestroyAggregateDevice(g_agg);
        g_agg = kAudioObjectUnknown;
    }
    if (g_tap != kAudioObjectUnknown) {
        if (taps_supported()) AudioHardwareDestroyProcessTap(g_tap);
        g_tap = kAudioObjectUnknown;
    }
    g_procs = nil;
}

static OSStatus build(NSArray<NSNumber *> *procs) API_AVAILABLE(macos(14.2)) {
    CATapDescription *desc = [[CATapDescription alloc] initStereoMixdownOfProcesses:procs];
    desc.name = @"AnyAmp Spectrum";
    desc.privateTap = YES;
    desc.muteBehavior = CATapUnmuted;
    OSStatus st = AudioHardwareCreateProcessTap(desc, &g_tap);
    if (st) return st;

    AudioStreamBasicDescription fmt;
    UInt32 s = sizeof(fmt);
    AudioObjectPropertyAddress fa = addr(kAudioTapPropertyFormat);
    if (AudioObjectGetPropertyData(g_tap, &fa, 0, NULL, &s, &fmt) == noErr && fmt.mSampleRate > 0)
        g_rate = fmt.mSampleRate;

    NSMutableDictionary *agg = [@{
        @kAudioAggregateDeviceNameKey : @"AnyAmp Spectrum",
        @kAudioAggregateDeviceUIDKey : [NSUUID UUID].UUIDString,
        @kAudioAggregateDeviceIsPrivateKey : @YES,
        @kAudioAggregateDeviceIsStackedKey : @NO,
        @kAudioAggregateDeviceTapAutoStartKey : @YES,
        @kAudioAggregateDeviceTapListKey : @[ @{
            @kAudioSubTapUIDKey : desc.UUID.UUIDString,
            @kAudioSubTapDriftCompensationKey : @YES,
        } ],
    } mutableCopy];
    NSString *out = default_output_uid();
    if (out) {
        agg[@kAudioAggregateDeviceMainSubDeviceKey] = out;
        agg[@kAudioAggregateDeviceSubDeviceListKey] = @[ @{@kAudioSubDeviceUIDKey : out} ];
    }
    st = AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)agg, &g_agg);
    if (st) return st;
    st = AudioDeviceCreateIOProcID(g_agg, io_proc, NULL, &g_proc);
    if (st) return st;
    return AudioDeviceStart(g_agg, g_proc);
}

void anyamp_tap_init(anyamp_samples_cb cb, void *ctx) {
    g_cb = cb;
    g_ctx = ctx;
}

/// Gleicht den Tap mit den aktuell vorhandenen App-Prozessen ab (neu aufbauen, wenn sich
/// die Menge geändert hat). Gibt einen OSStatus zurück; `count` = Anzahl getappter Prozesse.
/// -1 = macOS zu alt.
int32_t anyamp_tap_refresh(uint32_t *count) {
    @autoreleasepool {
        *count = 0;
        if (taps_supported()) {
            NSArray<NSNumber *> *procs = own_processes();
            if (g_procs && [procs isEqualToArray:g_procs]) {
                *count = (uint32_t)procs.count;
                return noErr;
            }
            teardown();
            if (procs.count == 0) return noErr;
            OSStatus st = build(procs);
            if (st) {
                teardown();
                return st;
            }
            g_procs = procs;
            *count = (uint32_t)procs.count;
            return noErr;
        }
        return -1;
    }
}

void anyamp_tap_stop(void) {
    @autoreleasepool {
        teardown();
    }
}
