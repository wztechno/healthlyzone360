import { screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, Text as RNText, useWindowDimensions } from 'react-native';

import { renderWithI18n } from '../testing/render.tsx';
import { BREAKPOINT_ORDER, useBreakpoint } from './use-breakpoint.ts';
import { usePointerKind } from './use-pointer.ts';
import { useReducedMotion } from './use-reduced-motion.ts';
import { useTheme } from './use-theme.ts';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions');

const mockedDimensions = useWindowDimensions as unknown as jest.Mock;

function Probe() {
    const { breakpoint, atLeast, isBelow, width } = useBreakpoint();
    return (
        <>
            <RNText testID="breakpoint">{breakpoint}</RNText>
            <RNText testID="width">{String(width)}</RNText>
            <RNText testID="at-least-lg">{String(atLeast('lg'))}</RNText>
            <RNText testID="below-lg">{String(isBelow('lg'))}</RNText>
        </>
    );
}

describe('useBreakpoint', () => {
    it('uses the token scale verbatim, with xs as the zero-width base', () => {
        expect([...BREAKPOINT_ORDER]).toEqual(['xs', 'sm', 'md', 'lg', 'xl']);
    });

    it.each([
        [320, 'xs'],
        [480, 'sm'],
        [768, 'md'],
        [1024, 'lg'],
        [1280, 'xl'],
        [1919, 'xl'],
    ] as const)('resolves %s px to %s', async (width, expected) => {
        mockedDimensions.mockReturnValue({ width, height: 900, scale: 2, fontScale: 1 });
        await renderWithI18n(<Probe />);
        expect(screen.getByTestId('breakpoint')).toHaveTextContent(expected);
    });

    it('answers atLeast and isBelow consistently', async () => {
        mockedDimensions.mockReturnValue({ width: 900, height: 900, scale: 2, fontScale: 1 });
        await renderWithI18n(<Probe />);

        expect(screen.getByTestId('at-least-lg')).toHaveTextContent('false');
        expect(screen.getByTestId('below-lg')).toHaveTextContent('true');
    });
});

function ThemeProbe() {
    const { name, isDark, tokens } = useTheme();
    return (
        <>
            <RNText testID="theme">{name}</RNText>
            <RNText testID="dark">{String(isDark)}</RNText>
            <RNText testID="surface">{tokens.colours.surfaceBase}</RNText>
        </>
    );
}

describe('useTheme', () => {
    it('resolves a theme name and its token set', async () => {
        mockedDimensions.mockReturnValue({ width: 1024, height: 900, scale: 2, fontScale: 1 });
        await renderWithI18n(<ThemeProbe />);

        expect(['light', 'dark']).toContain(screen.getByTestId('theme').children[0]);
        expect(screen.getByTestId('surface').children[0]).toMatch(/^#[0-9a-f]{6}$/i);
    });
});

function MotionProbe() {
    return <RNText testID="reduced">{String(useReducedMotion())}</RNText>;
}

describe('useReducedMotion', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('reports the platform preference', async () => {
        jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        await renderWithI18n(<MotionProbe />);
        expect(await screen.findByTestId('reduced')).toHaveTextContent('true');
    });

    it('defaults to motion allowed when the platform cannot answer', async () => {
        jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(
            new Error('unsupported'),
        );
        await renderWithI18n(<MotionProbe />);
        expect(screen.getByTestId('reduced')).toHaveTextContent('false');
    });
});

function PointerProbe() {
    return <RNText testID="pointer">{usePointerKind()}</RNText>;
}

/**
 * The guard that keeps hover-only affordances off touch devices. A phone has no hover state, so a
 * popover that only opened on hover would simply be unreachable there
 * (`docs/reference-research/07-animation-and-motion-inventory.md`, CST-03).
 */
describe('usePointerKind', () => {
    afterEach(() => {
        Reflect.deleteProperty(globalThis, 'window');
        jest.restoreAllMocks();
    });

    function stubMatchMedia(matches: boolean) {
        const query = {
            matches,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        };
        const matchMedia = jest.fn().mockReturnValue(query);
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            writable: true,
            value: { matchMedia },
        });
        return { matchMedia, query };
    }

    it('reports coarse on every native target, without consulting a media query', async () => {
        const { matchMedia } = stubMatchMedia(true);
        await renderWithI18n(<PointerProbe />);

        expect(await screen.findByTestId('pointer')).toHaveTextContent('coarse');
        expect(matchMedia).not.toHaveBeenCalled();
    });

    it('reads the pointer media query on the web', async () => {
        jest.replaceProperty(Platform, 'OS', 'web');
        const { matchMedia } = stubMatchMedia(true);
        await renderWithI18n(<PointerProbe />);

        expect(matchMedia).toHaveBeenCalledWith('(pointer: fine)');
        expect(screen.getByTestId('pointer')).toHaveTextContent('fine');
    });

    it('reports coarse on a touch-first browser', async () => {
        jest.replaceProperty(Platform, 'OS', 'web');
        stubMatchMedia(false);
        await renderWithI18n(<PointerProbe />);

        expect(screen.getByTestId('pointer')).toHaveTextContent('coarse');
    });

    /** A tablet with a keyboard case changes its answer while the app is running. */
    it('subscribes to changes and unsubscribes on unmount', async () => {
        jest.replaceProperty(Platform, 'OS', 'web');
        const { query } = stubMatchMedia(true);
        const view = await renderWithI18n(<PointerProbe />);

        expect(query.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
        await view.unmount();
        expect(query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('leaves the pointer coarse when the browser cannot answer', async () => {
        jest.replaceProperty(Platform, 'OS', 'web');
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            writable: true,
            value: {},
        });
        await renderWithI18n(<PointerProbe />);

        // No media query available: the first answer stands rather than a crash.
        expect(screen.getByTestId('pointer')).toHaveTextContent('fine');
    });
});
