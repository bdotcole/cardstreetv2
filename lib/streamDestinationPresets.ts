/**
 * Multistream destination presets — PURE (no Node/Supabase imports) so the
 * console's add-destination form and the server validation read one list.
 *
 * serverUrl is the platform's fixed RTMP ingest when it has one. Instagram
 * (Live Producer) and TikTok (LIVE Studio) mint a per-session server URL next
 * to the key, so those are pasted by the seller each show. The URL rules are
 * deliberately strict: an rtmp(s):// host with an optional port and path,
 * nothing else — a stream key is a bearer credential and the composed URL is
 * handed straight to LiveKit.
 */

export const DESTINATION_PLATFORMS = [
    'facebook',
    'youtube',
    'instagram',
    'tiktok',
    'twitch',
    'custom',
] as const;
export type DestinationPlatform = (typeof DESTINATION_PLATFORMS)[number];

export function isDestinationPlatform(value: unknown): value is DestinationPlatform {
    return typeof value === 'string' && (DESTINATION_PLATFORMS as readonly string[]).includes(value);
}

export interface PlatformPreset {
    /** Default label for a new destination. */
    label: string;
    /** Fixed ingest URL (without the key) or null when the platform issues one per session. */
    serverUrl: string | null;
    /** FontAwesome brand icon class. */
    icon: string;
    /** Where the seller finds the key — shown under the form. */
    keyHelp: string;
    keyHelpTh: string;
}

export const PLATFORM_PRESETS: Record<DestinationPlatform, PlatformPreset> = {
    facebook: {
        label: 'Facebook Live',
        serverUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/',
        icon: 'fa-brands fa-facebook',
        keyHelp:
            'Facebook Page > Live video > Go live > Streaming software: copy the Stream key (turn on "Persistent stream key" so it never changes).',
        keyHelpTh:
            'เพจ Facebook > วิดีโอถ่ายทอดสด > เริ่มถ่ายทอดสด > ซอฟต์แวร์สตรีม: คัดลอกคีย์สตรีม (เปิด "คีย์สตรีมถาวร" เพื่อไม่ต้องเปลี่ยนทุกครั้ง)',
    },
    youtube: {
        label: 'YouTube Live',
        serverUrl: 'rtmps://a.rtmps.youtube.com:443/live2',
        icon: 'fa-brands fa-youtube',
        keyHelp: 'YouTube Studio > Go live > Stream: copy the Stream key (the default key is reusable).',
        keyHelpTh: 'YouTube Studio > ถ่ายทอดสด > สตรีม: คัดลอกคีย์สตรีม (คีย์ค่าเริ่มต้นใช้ซ้ำได้)',
    },
    instagram: {
        label: 'Instagram Live',
        serverUrl: null,
        icon: 'fa-brands fa-instagram',
        keyHelp:
            'instagram.com/live/producer (desktop): paste BOTH the stream URL and the stream key — Instagram issues a new pair for every broadcast.',
        keyHelpTh:
            'instagram.com/live/producer (บนคอม): วางทั้ง URL สตรีมและคีย์สตรีม — Instagram ออกคู่ใหม่ทุกครั้งที่ไลฟ์',
    },
    tiktok: {
        label: 'TikTok LIVE',
        serverUrl: null,
        icon: 'fa-brands fa-tiktok',
        keyHelp:
            'TikTok LIVE Studio (or the LIVE access page) > Server URL + Stream key. Needs LIVE access on the account.',
        keyHelpTh:
            'TikTok LIVE Studio (หรือหน้า LIVE access) > Server URL + Stream key — บัญชีต้องมีสิทธิ์ LIVE',
    },
    twitch: {
        label: 'Twitch',
        serverUrl: 'rtmp://live.twitch.tv/app/',
        icon: 'fa-brands fa-twitch',
        keyHelp: 'Twitch Creator Dashboard > Settings > Stream: copy the Primary Stream key.',
        keyHelpTh: 'Twitch Creator Dashboard > Settings > Stream: คัดลอก Primary Stream key',
    },
    custom: {
        label: 'Custom RTMP',
        serverUrl: null,
        icon: 'fa-solid fa-tower-broadcast',
        keyHelp: 'Any RTMP / RTMPS ingest: paste the server URL and the stream key separately.',
        keyHelpTh: 'RTMP / RTMPS ปลายทางใดก็ได้: วาง URL เซิร์ฟเวอร์และคีย์สตรีมแยกกัน',
    },
};

const RTMP_URL_RE = /^rtmps?:\/\/[A-Za-z0-9.-]+(?::\d{2,5})?(?:\/[A-Za-z0-9._~%/-]*)?$/;
export const RTMP_URL_MAX = 500;
export const STREAM_KEY_MIN = 4;
export const STREAM_KEY_MAX = 400;
export const DESTINATION_LABEL_MAX = 60;
export const DESTINATIONS_PER_SELLER_MAX = 10;

/** Trimmed, validated ingest URL or null. */
export function normalizeRtmpUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const url = raw.trim();
    if (url.length < 8 || url.length > RTMP_URL_MAX) return null;
    return RTMP_URL_RE.test(url) ? url : null;
}

/** Trimmed, validated key (printable ASCII, no whitespace) or null. */
export function normalizeStreamKey(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const key = raw.trim();
    if (key.length < STREAM_KEY_MIN || key.length > STREAM_KEY_MAX) return null;
    return /^[\x21-\x7e]+$/.test(key) ? key : null;
}

/** `rtmps://host/app/` + `key` -> `rtmps://host/app/key` (exactly one slash between). */
export function composeStreamUrl(serverUrl: string, key: string): string {
    return `${serverUrl.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`;
}
