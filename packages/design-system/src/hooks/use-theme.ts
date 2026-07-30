import { themes } from '@healthy360/design-tokens';
import type { ThemeName, ThemeTokens } from '@healthy360/design-tokens';
import { useColorScheme } from 'nativewind';
import { useCallback, useMemo } from 'react';

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
    const { colorScheme, setColorScheme, toggleColorScheme } = useColorScheme();
    const name: ThemeName = colorScheme === 'dark' ? 'dark' : 'light';

    const setTheme = useCallback(
        (next: ThemeName | 'system') => {
            setColorScheme(next);
        },
        [setColorScheme],
    );

    const toggleTheme = useCallback(() => {
        toggleColorScheme();
    }, [toggleColorScheme]);

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
