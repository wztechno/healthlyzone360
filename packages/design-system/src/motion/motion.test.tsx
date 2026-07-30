import { screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { flattenStyle, renderWithI18n } from '../testing/render.tsx';
import { Collapse } from './collapse.tsx';
import { FadeIn } from './fade-in.tsx';
import { PageTransition } from './page-transition.tsx';
import { Shimmer } from './shimmer.tsx';
import { SLIDE_EDGES, SlideIn } from './slide-in.tsx';
import { useAnimatedNumber } from './use-animated-number.ts';
import { useMotion } from './use-motion.ts';

/**
 * The platform preference is stubbed at the hook rather than at `AccessibilityInfo`.
 *
 * The real hook resolves asynchronously — motion is assumed allowed for one render, then the
 * preference arrives — which is correct behaviour but makes an assertion about the *first* rendered
 * style impossible to write without racing it. Stubbing the answer lets every test below assert the
 * thing that actually matters: what a reduced-motion user sees on the frame the component mounts.
 */
let mockReducedMotion = false;
jest.mock('../hooks/use-reduced-motion.ts', () => ({
    useReducedMotion: () => mockReducedMotion,
}));

beforeEach(() => {
    mockReducedMotion = false;
});

function styleOf(testID: string): Record<string, unknown> {
    return flattenStyle(screen.getByTestId(testID).props.style);
}

function firstTransform(testID: string): Record<string, unknown> {
    const transform = styleOf(testID)['transform'];
    expect(Array.isArray(transform)).toBe(true);
    return (transform as readonly Record<string, unknown>[])[0]!;
}

function MotionProbe() {
    const { enabled, axisSign, direction, durations, distances, stagger } = useMotion();
    return (
        <>
            <RNText testID="enabled">{String(enabled)}</RNText>
            <RNText testID="sign">{String(axisSign)}</RNText>
            <RNText testID="direction">{direction}</RNText>
            <RNText testID="normal">{String(durations.normal)}</RNText>
            <RNText testID="medium">{String(distances.medium)}</RNText>
            <RNText testID="stagger-3">{String(stagger(3))}</RNText>
            <RNText testID="stagger-40">{String(stagger(40))}</RNText>
        </>
    );
}

describe('useMotion', () => {
    it('reports motion enabled with a positive axis in English', async () => {
        await renderWithI18n(<MotionProbe />, 'en');

        expect(screen.getByTestId('enabled')).toHaveTextContent('true');
        expect(screen.getByTestId('sign')).toHaveTextContent('1');
        expect(screen.getByTestId('direction')).toHaveTextContent('ltr');
        expect(screen.getByTestId('normal')).toHaveTextContent('200');
        expect(screen.getByTestId('medium')).toHaveTextContent('16');
    });

    /** The RTL correction: every horizontal offset is multiplied by this, and nothing else changes. */
    it('flips the axis sign in Arabic', async () => {
        await renderWithI18n(<MotionProbe />, 'ar');

        expect(screen.getByTestId('sign')).toHaveTextContent('-1');
        expect(screen.getByTestId('direction')).toHaveTextContent('rtl');
    });

    it('caps the stagger so a long list does not queue behind an ever-growing delay', async () => {
        await renderWithI18n(<MotionProbe />);

        expect(screen.getByTestId('stagger-3')).toHaveTextContent('120');
        expect(screen.getByTestId('stagger-40')).toHaveTextContent('280');
    });

    it('zeroes every duration, distance and delay under reduced motion', async () => {
        mockReducedMotion = true;
        await renderWithI18n(<MotionProbe />);

        expect(screen.getByTestId('enabled')).toHaveTextContent('false');
        expect(screen.getByTestId('normal')).toHaveTextContent('0');
        expect(screen.getByTestId('medium')).toHaveTextContent('0');
        expect(screen.getByTestId('stagger-3')).toHaveTextContent('0');
    });
});

describe('FadeIn', () => {
    it('renders the final opacity as a literal under reduced motion', async () => {
        mockReducedMotion = true;
        await renderWithI18n(
            <FadeIn testID="fade">
                <RNText testID="body">Content</RNText>
            </FadeIn>,
        );

        expect(styleOf('fade')['opacity']).toBe(1);
        expect(screen.getByTestId('body')).toBeTruthy();
    });

    it('drives opacity from an animated value when motion is allowed', async () => {
        await renderWithI18n(
            <FadeIn testID="fade">
                <RNText>Content</RNText>
            </FadeIn>,
        );

        expect(styleOf('fade')['opacity']).not.toBe(1);
    });
});

describe('SlideIn', () => {
    it.each(SLIDE_EDGES)(
        'renders a zero translation and full opacity for edge=%s under reduced motion',
        async (edge) => {
            mockReducedMotion = true;
            await renderWithI18n(
                <SlideIn testID="slide" edge={edge}>
                    <RNText testID="body">Content</RNText>
                </SlideIn>,
            );

            expect(styleOf('slide')['opacity']).toBe(1);
            expect(Object.values(firstTransform('slide'))).toEqual([0]);
            expect(screen.getByTestId('body')).toBeTruthy();
        },
    );

    it('travels on the horizontal axis for a logical edge', async () => {
        mockReducedMotion = true;
        await renderWithI18n(
            <SlideIn testID="slide" edge="start">
                <RNText>Content</RNText>
            </SlideIn>,
        );

        expect(Object.keys(firstTransform('slide'))).toEqual(['translateX']);
    });

    it('travels on the vertical axis for the bottom edge', async () => {
        mockReducedMotion = true;
        await renderWithI18n(
            <SlideIn testID="sheet" edge="bottom">
                <RNText>Content</RNText>
            </SlideIn>,
        );

        expect(Object.keys(firstTransform('sheet'))).toEqual(['translateY']);
    });

    it('animates rather than snapping when motion is allowed', async () => {
        await renderWithI18n(
            <SlideIn testID="slide" edge="start">
                <RNText>Content</RNText>
            </SlideIn>,
        );

        expect(Object.values(firstTransform('slide'))[0]).not.toBe(0);
    });
});

describe('Collapse', () => {
    it('renders its children with no height constraint when open under reduced motion', async () => {
        mockReducedMotion = true;
        await renderWithI18n(
            <Collapse testID="panel" open>
                <RNText testID="body">Content</RNText>
            </Collapse>,
        );

        expect(screen.getByTestId('body')).toBeTruthy();
        expect(styleOf('panel')['height']).toBeUndefined();
    });

    /** A collapsed panel must not keep focusable controls in the tab order. */
    it('unmounts its children when closed', async () => {
        mockReducedMotion = true;
        await renderWithI18n(
            <Collapse testID="panel" open={false}>
                <RNText testID="body">Content</RNText>
            </Collapse>,
        );

        expect(screen.queryByTestId('body')).toBeNull();
        expect(screen.getByTestId('panel').props['aria-hidden']).toBe(true);
    });

    it('keeps its container present so an aria-controls reference resolves', async () => {
        mockReducedMotion = true;
        await renderWithI18n(
            <Collapse testID="panel" nativeID="panel-region" role="region" open={false}>
                <RNText>Content</RNText>
            </Collapse>,
        );

        const node = screen.getByTestId('panel');
        expect(node.props.nativeID).toBe('panel-region');
        expect(node.props.role).toBe('region');
    });
});

describe('Shimmer', () => {
    it('renders no moving band at all under reduced motion', async () => {
        mockReducedMotion = true;
        await renderWithI18n(
            <Shimmer testID="shim">
                <RNText testID="body">Content</RNText>
            </Shimmer>,
        );

        expect(screen.queryByTestId('shim-band')).toBeNull();
        expect(screen.getByTestId('body')).toBeTruthy();
    });
});

function NumberProbe({ value }: { readonly value: number }) {
    return <RNText testID="figure">{String(useAnimatedNumber(value))}</RNText>;
}

describe('useAnimatedNumber', () => {
    it('returns the target immediately under reduced motion', async () => {
        mockReducedMotion = true;
        await renderWithI18n(<NumberProbe value={2100} />);

        expect(screen.getByTestId('figure')).toHaveTextContent('2100');
    });

    it('starts at the first value rather than counting up from zero', async () => {
        await renderWithI18n(<NumberProbe value={1850} />);

        expect(screen.getByTestId('figure')).toHaveTextContent('1850');
    });
});

describe('PageTransition', () => {
    it('renders final styles immediately under reduced motion', async () => {
        mockReducedMotion = true;
        await renderWithI18n(
            <PageTransition testID="page">
                <RNText testID="body">Screen</RNText>
            </PageTransition>,
        );

        expect(styleOf('page')['opacity']).toBe(1);
        expect(Object.values(firstTransform('page'))).toEqual([0]);
        expect(screen.getByTestId('body')).toBeTruthy();
    });

    it('animates the content, not the navigator, when motion is allowed', async () => {
        await renderWithI18n(
            <PageTransition testID="page">
                <RNText testID="body">Screen</RNText>
            </PageTransition>,
        );

        expect(styleOf('page')['opacity']).not.toBe(1);
        expect(screen.getByTestId('body')).toBeTruthy();
    });
});
