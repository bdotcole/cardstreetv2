/**
 * libheif-js ships no types for its pre-bundled ES module build, which is the
 * one lib/listingPhoto.ts loads (the CommonJS build's dynamic-require shim
 * makes webpack warn on every compile). The factory returns the Emscripten
 * module; `ready` resolves once the WASM is instantiated.
 */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
    export interface LibheifImage {
        get_width(): number;
        get_height(): number;
        display(target: ImageData, done: (result: ImageData | null) => void): void;
        free(): void;
    }
    export interface LibheifDecoder {
        decode(data: Uint8Array): LibheifImage[];
        decoder: { delete(): void };
    }
    export interface LibheifModule {
        ready?: Promise<unknown>;
        HeifDecoder: new () => LibheifDecoder;
    }
    const factory: (options?: Record<string, unknown>) => LibheifModule | Promise<LibheifModule>;
    export default factory;
}
