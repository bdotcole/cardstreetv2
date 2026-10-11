/**
 * English name for an ISO 639-1 code, for "translated from Thai" labels.
 * Client-safe (no dependencies) so the admin console and the server-side
 * support emails label translations the same way.
 */
export function languageName(code: string | null | undefined): string {
    switch ((code ?? '').toLowerCase()) {
        case 'th': return 'Thai';
        case 'ja': return 'Japanese';
        case 'en': return 'English';
        case 'zh': return 'Chinese';
        case 'ko': return 'Korean';
        case 'vi': return 'Vietnamese';
        case 'ms': return 'Malay';
        case 'id': return 'Indonesian';
        case 'tl': case 'fil': return 'Filipino';
        default: return code ? code.toUpperCase() : 'another language';
    }
}
