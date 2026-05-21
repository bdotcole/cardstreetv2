'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
    parseGoogleAddressToThai,
    type ParsedThaiAddress,
    type GoogleAddressComponent,
} from '@/lib/utils/parseGoogleAddress';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GooglePlacesAddressInputProps {
    /** Called when a user selects a place and the address is parsed */
    onAddressParsed: (address: ParsedThaiAddress, rawFormatted: string) => void;
    /** Google Maps API Key — falls back to env var NEXT_PUBLIC_GOOGLE_MAPS_API_KEY */
    apiKey?: string;
    /** Initial value for the text input */
    defaultValue?: string;
    /** Placeholder text */
    placeholder?: string;
    /** Additional CSS class names */
    className?: string;
    /** Whether the input is disabled */
    disabled?: boolean;
    /** ID attribute for the input (for labelling) */
    id?: string;
}

// Extend Window to include google maps types
declare global {
    interface Window {
        google?: any;
        __googleMapsCallbacks?: (() => void)[];
        __googleMapsLoaded?: boolean;
        gm_authFailure?: () => void;
        __cardstreetGmAuthFailed?: boolean;
    }
}

// ---------------------------------------------------------------------------
// Google Maps Script Loader (singleton)
// ---------------------------------------------------------------------------

function loadGoogleMapsScript(apiKey: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // Already loaded
        if (window.__googleMapsLoaded && window.google?.maps?.places) {
            resolve();
            return;
        }

        // Script is loading — register a callback
        if (document.querySelector('script[data-google-maps]')) {
            if (!window.__googleMapsCallbacks) {
                window.__googleMapsCallbacks = [];
            }
            window.__googleMapsCallbacks.push(() => resolve());
            return;
        }

        // First time — create the script
        window.__googleMapsCallbacks = [];

        const script = document.createElement('script');
        script.setAttribute('data-google-maps', 'true');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=th&region=TH`;
        script.async = true;
        script.defer = true;

        script.onload = () => {
            window.__googleMapsLoaded = true;
            resolve();
            // Resolve all waiting callbacks
            window.__googleMapsCallbacks?.forEach((cb) => cb());
            window.__googleMapsCallbacks = [];
        };

        script.onerror = () => {
            reject(new Error('Failed to load Google Maps script'));
        };

        document.head.appendChild(script);
    });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GooglePlacesAddressInput({
    onAddressParsed,
    apiKey,
    defaultValue = '',
    placeholder = 'พิมพ์ที่อยู่เพื่อค้นหา...',
    className = '',
    disabled = false,
    id = 'google-places-address-input',
}: GooglePlacesAddressInputProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const autocompleteRef = useRef<any>(null);
    const [inputValue, setInputValue] = useState(defaultValue);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const resolvedApiKey =
        apiKey || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

    // Hook Google's auth-failure callback so referrer/key restriction errors
    // surface inline instead of failing silently (most common failure mode on
    // Capacitor mobile, where the WebView origin isn't in the key's allowlist).
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (window.__cardstreetGmAuthFailed) {
            setError(
                'Google Maps key rejected for this origin. Check the API key restrictions in Google Cloud Console.'
            );
            return;
        }
        const prev = window.gm_authFailure;
        window.gm_authFailure = () => {
            window.__cardstreetGmAuthFailed = true;
            setError(
                'Google Maps key rejected for this origin. Check the API key restrictions in Google Cloud Console.'
            );
            prev?.();
        };
    }, []);

    // Initialize autocomplete once the script is loaded
    const initAutocomplete = useCallback(() => {
        if (!inputRef.current || !window.google?.maps?.places) return;

        autocompleteRef.current = new window.google.maps.places.Autocomplete(
            inputRef.current,
            {
                // Restrict to Thailand for better results
                componentRestrictions: { country: 'th' },
                // Request address components + geometry
                fields: ['address_components', 'formatted_address', 'geometry'],
                types: ['address'],
            }
        );

        autocompleteRef.current.addListener('place_changed', () => {
            const place = autocompleteRef.current.getPlace();

            if (!place || !place.address_components) {
                console.warn('[GooglePlaces] No address_components in selected place');
                return;
            }

            const components: GoogleAddressComponent[] = place.address_components;
            const parsed = parseGoogleAddressToThai(components);
            const rawFormatted = place.formatted_address || '';

            // Update the visible input text with the formatted address
            setInputValue(rawFormatted);

            // Notify parent
            onAddressParsed(parsed, rawFormatted);
        });
    }, [onAddressParsed]);

    // Load the Google Maps script
    useEffect(() => {
        if (!resolvedApiKey) {
            setError('Google Maps API key is missing. Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.');
            setIsLoading(false);
            return;
        }

        let cancelled = false;

        loadGoogleMapsScript(resolvedApiKey)
            .then(() => {
                if (!cancelled) {
                    setIsLoading(false);
                    initAutocomplete();
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err.message);
                    setIsLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [resolvedApiKey, initAutocomplete]);

    // Re-init if ref changes (shouldn't, but safety net)
    useEffect(() => {
        if (!isLoading && !error) {
            initAutocomplete();
        }
    }, [isLoading, error, initAutocomplete]);

    // Cleanup autocomplete listener on unmount
    useEffect(() => {
        return () => {
            if (autocompleteRef.current && window.google?.maps?.event) {
                window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
            }
        };
    }, []);

    return (
        <div className="google-places-address-input-wrapper" style={{ position: 'relative' }}>
            <input
                ref={inputRef}
                id={id}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={isLoading ? 'กำลังโหลด...' : placeholder}
                disabled={disabled || isLoading}
                className={className}
                autoComplete="off"
            />
            {error && (
                <p style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                    {error}
                </p>
            )}
        </div>
    );
}
