import { themes } from '@healthy360/design-tokens';
import type { ThemeName, ThemeTokens } from '@healthy360/design-tokens';
import { useColorScheme } from 'nativewind';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';

/** Web only, and named to match the `h360_locale` cookie the same document shell already writes. */
const THEME_COOKIE = 'h360_theme';

/** One year, root path, Lax — the same shape as the locale cookie this mirrors. */
const THEME_COOKIE_MAX_AGE = 31_536_000;

function isThemeName(value: string | undefined): value is ThemeName {
    return value === 'light' || value === 'dark';
}

/**
 * Mirrors the resolved scheme onto `<html>` as a `.light` class.
 *
 * This is the fix for a toggle that did nothing on a machine whose system preference is dark.
 * `tokens.css` ends with
 *
 * ```css
 * @media (prefers-color-scheme: dark) { :root:not(.light) { … dark tokens … } }
 * ```
 *
 * so a visitor with a dark system gets dark styling before any JavaScript has run. The `:not(.light)`
 * is the escape hatch for "this person explicitly asked for light" — and nothing in the application
 * was ever writing that class. NativeWind only ever adds and removes `.dark`, which the media query
 * outranks, so on a dark system every press left the query matching and the page dark; on a light
 * system the same code worked, because there the query never matched in the first place.
 *
 * The two classes are mutually exclusive by construction — `.dark` is NativeWind's and `.light` is
 * this one, written only when the resolved scheme is light — so they can never both apply.
 */
function syncLightClass(name: ThemeName): void {
    if (Platform.OS !== 'web') return;
    globalThis.document?.documentElement.classList.toggle('light', name === 'light');
}

function readPersistedTheme(): ThemeName | null {
    if (Platform.OS !== 'web') return null;
    try {
        const cookie = globalThis.document?.cookie ?? '';
        const value = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([^;]*)`).exec(cookie)?.[1];
        return isThemeName(value) ? value : null;
    } catch {
        return null;
    }
}

function persistTheme(name: ThemeName): void {
    if (Platform.OS !== 'web') return;
    try {
        const document_ = globalThis.document;
        if (document_ === undefined) return;
        document_.cookie = `${THEME_COOKIE}=${name}; path=/; max-age=${String(THEME_COOKIE_MAX_AGE)}; samesite=lax`;
    } catch {
        // A browser refusing cookies still gets a working toggle for the current session; the
        // choice simply does not survive a reload, which is better than failing the press.
    }
}

export interface UseThemeResult {
    readonly name: ThemeName;
    readonly isDark: boolean;
    /** The resolved token set — raw colour values, for the few places a class cannot reach. */
    readonly tokens: ThemeTokens;
    readonly setTheme: (next: ThemeName | 'system') => void;
    readonly toggleTheme: () => void;
}

/**
 * The single reader of the colour scheme.
 *
 * NativeWind's `useColorScheme` toggles the `.dark` class on the web document and drives the native
 * appearance directly, which is exactly what the `.dark` block in `@healthy360/design-tokens`
 * expects. Components should almost always express colour with token classes
 * (`bg-surface-raised`, `text-content-primary`) and reach for `tokens` only where a class cannot go
 * — a shadow object, an SVG fill, a native-only prop.
 *
 * High-contrast themes are out of scope for Phase 1.
 */
export function useTheme(): UseThemeResult {
    const { colorScheme, setColorScheme } = useColorScheme();
    const name: ThemeName = colorScheme === 'dark' ? 'dark' : 'light';

    // Every change, including the first render and any made from another component, reaches the
    // document. `syncLightClass` explains why the class has to be written at all.
    useEffect(() => {
        syncLightClass(name);
    }, [name]);

    /**
     * The persisted choice, restored once.
     *
     * NativeWind reads the *system* preference on boot and knows nothing about what this person
     * chose last time, so without this a reload silently discards the choice — which reads as the
     * toggle having failed rather than as a preference having expired.
     */
    const restored = useRef(false);
    useEffect(() => {
        if (restored.current) return;
        restored.current = true;
        const stored = readPersistedTheme();
        if (stored !== null && stored !== name) setColorScheme(stored);
    }, [name, setColorScheme]);

    const setTheme = useCallback(
        (next: ThemeName | 'system') => {
            setColorScheme(next);
            // `system` hands control back to the device, so the stored override would be a lie.
            if (next === 'system') return;
            persistTheme(next);
        },
        [setColorScheme],
    );

    /**
     * Set explicitly from the *resolved* name rather than delegating to NativeWind's own toggle.
     *
     * `toggleColorScheme` flips whatever it has stored internally, which on a fresh load with a
     * system-dark machine is not necessarily the scheme actually on screen — so the first press
     * could land on the value already showing and appear to do nothing at all.
     */
    const toggleTheme = useCallback(() => {
        setTheme(name === 'dark' ? 'light' : 'dark');
    }, [name, setTheme]);

    return useMemo(
        () => ({
            name,
            isDark: name === 'dark',
            tokens: themes[name],
            setTheme,
            toggleTheme,
        }),
        [name, setTheme, toggleTheme],
    );
}
