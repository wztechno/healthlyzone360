import { act, screen } from '@testing-library/react-native';
import { Animated, Text as RNText } from 'react-native';

import { DataList } from '../content/data-list.tsx';
import type { DataListColumn } from '../content/data-list.tsx';
import { flattenStyle, renderWithI18n, withI18n } from '../testing/render.tsx';
import { Cascade, CascadeItem } from './cascade.tsx';
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

interface EntranceRow {
    readonly id: string;
    readonly name: string;
}

const ENTRANCE_ROWS: readonly EntranceRow[] = [
    { id: 'a', name: 'Tahini' },
    { id: 'b', name: 'Sumac' },
];

const ENTRANCE_COLUMNS: readonly DataListColumn<EntranceRow>[] = [
    { key: 'name', label: 'Designation', width: 240, priority: 100, value: (row) => row.name },
];

function EntranceList({
    rows = ENTRANCE_ROWS,
    rowEntrance,
}: {
    readonly rows?: readonly EntranceRow[];
    readonly rowEntrance?: boolean;
}) {
    return (
        <DataList
            testID="list"
            label="Ingredients"
            rows={rows}
            rowKey={(row) => row.id}
            columns={ENTRANCE_COLUMNS}
            rowEntrance={rowEntrance}
        />
    );
}

describe("DataList's row entrance", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('wraps nothing unless the list asks for it', async () => {
        await renderWithI18n(<EntranceList />);

        expect(screen.queryByTestId('list-row-a-entrance')).toBeNull();
    });

    it('brings each row up from below, leaving the row its own element', async () => {
        await renderWithI18n(<EntranceList rowEntrance />);

        expect(styleOf('list-row-a-entrance')['opacity']).not.toBe(1);
        expect(Object.keys(firstTransform('list-row-a-entrance'))).toEqual(['translateY']);
        // Only the box around the row moves. The row keeps its role and its id, so everything that
        // finds a row — a test, a screen reader, the hover tint — finds the same element as before.
        expect(screen.getByTestId('list-row-a').props.role).toBe('row');
    });

    it('draws every row in place under reduced motion, with no style of its own', async () => {
        mockReducedMotion = true;
        await renderWithI18n(<EntranceList rowEntrance />);

        for (const id of ['a', 'b']) {
            expect(styleOf(`list-row-${id}-entrance`)).toEqual({});
        }
    });

    /**
     * A row's index changes on every sort, and `SlideIn` replays when its delay changes — so a
     * delay read from the index on each render would start every moved row's entrance again.
     * Counted at `Animated.timing` because that is the replay itself: the animation clock does not
     * advance under Jest, so "the row stayed visible" cannot be observed directly.
     */
    it('does not send a row back through its entrance when the list is re-sorted', async () => {
        const timing = jest.spyOn(Animated, 'timing');
        const view = await renderWithI18n(<EntranceList rowEntrance />);
        const entrances = timing.mock.calls.length;
        expect(entrances).toBeGreaterThanOrEqual(ENTRANCE_ROWS.length);

        await act(async () => {
            view.rerender(
                withI18n(<EntranceList rowEntrance rows={[...ENTRANCE_ROWS].reverse()} />),
            );
        });

        expect(timing.mock.calls.length).toBe(entrances);
    });

    it('brings in a row that joins the list', async () => {
        const timing = jest.spyOn(Animated, 'timing');
        const view = await renderWithI18n(<EntranceList rowEntrance />);
        const entrances = timing.mock.calls.length;

        await act(async () => {
            view.rerender(
                withI18n(
                    <EntranceList
                        rowEntrance
                        rows={[...ENTRANCE_ROWS, { id: 'c', name: 'Za’atar' }]}
                    />,
                ),
            );
        });

        expect(timing.mock.calls.length).toBe(entrances + 1);
        expect(screen.getByTestId('list-row-c-entrance')).toBeTruthy();
    });
});

/** The `delay` each started entrance was given, in the order they were created. */
function entranceDelays(timing: jest.SpyInstance): number[] {
    return timing.mock.calls.map((call) => (call[1] as Animated.TimingAnimationConfig).delay ?? 0);
}

describe('Cascade', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('makes a band of each child, dropping nothing-children and opening fragments', async () => {
        const error = jest.spyOn(console, 'error');
        await renderWithI18n(
            <Cascade testID="page">
                <RNText testID="a">A</RNText>
                {null}
                {false}
                <>
                    <RNText testID="b">B</RNText>
                    <RNText testID="c">C</RNText>
                </>
            </Cascade>,
        );

        // Three bands: the fragment's two children are bands of their own, so they keep the
        // Stack's gap between them exactly as they did before the page cascaded.
        expect(screen.getByTestId('page').children).toHaveLength(3);
        for (const id of ['a', 'b', 'c']) expect(screen.getByTestId(id)).toBeTruthy();
        // A fragment's first child is not keyed `.0` alongside the cascade's own first child.
        expect(error.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
    });

    it('staggers the bands down the page', async () => {
        const timing = jest.spyOn(Animated, 'timing');
        await renderWithI18n(
            <Cascade>
                <RNText>A</RNText>
                <RNText>B</RNText>
                <RNText>C</RNText>
            </Cascade>,
        );

        expect(entranceDelays(timing)).toEqual([0, 40, 80]);
    });

    it('lets a nested cascade continue the count instead of rising as a band itself', async () => {
        const timing = jest.spyOn(Animated, 'timing');
        await renderWithI18n(
            <Cascade>
                <RNText>Header</RNText>
                <RNText>Figures</RNText>
                <Cascade testID="grid">
                    <RNText>Group one</RNText>
                    <RNText>Group two</RNText>
                </Cascade>
            </Cascade>,
        );

        // Four entrances, not five: the grid is not wrapped, and its groups follow the figures.
        expect(entranceDelays(timing)).toEqual([0, 40, 80, 120]);
    });

    it('brings in a band that appears above the others without replaying them', async () => {
        const timing = jest.spyOn(Animated, 'timing');
        const page = (banner: boolean) => (
            <Cascade>
                {banner ? <RNText key="banner">Saved</RNText> : null}
                <RNText key="toolbar">Toolbar</RNText>
                <RNText key="list">List</RNText>
            </Cascade>
        );
        const view = await renderWithI18n(page(false));
        expect(timing).toHaveBeenCalledTimes(2);

        await act(async () => {
            view.rerender(withI18n(page(true)));
        });

        expect(timing).toHaveBeenCalledTimes(3);
        // It answers something that just happened, so it rises in at once rather than waiting
        // behind a delay meant for the page's first arrival.
        expect(entranceDelays(timing)).toEqual([0, 40, 0]);
    });

    it('keeps a band passed as its own CascadeItem, placing it in the count', async () => {
        const timing = jest.spyOn(Animated, 'timing');
        await renderWithI18n(
            <Cascade>
                <RNText>Opening</RNText>
                <CascadeItem index={99} testID="selling" className="hidden">
                    <RNText>Selling</RNText>
                </CascadeItem>
            </Cascade>,
        );

        // Not wrapped a second time, and its own number is replaced by its place on the page.
        expect(screen.getByTestId('selling')).toBeTruthy();
        expect(entranceDelays(timing)).toEqual([0, 40]);
    });

    it('settles into a plain, depth-neutral box under reduced motion', async () => {
        mockReducedMotion = true;
        await renderWithI18n(
            <CascadeItem index={2} testID="band">
                <RNText>Band</RNText>
            </CascadeItem>,
        );

        // No transform, no opacity: a transform would be a stacking context, and an inline
        // popover inside the band would be trapped under the band below it. (Its `z-auto` is a
        // class, which NativeWind resolves only in a real stylesheet, so it is checked there.)
        expect(styleOf('band')).toEqual({});
    });

    it('moves while it enters when motion is allowed', async () => {
        await renderWithI18n(
            <CascadeItem index={0} testID="band">
                <RNText>Band</RNText>
            </CascadeItem>,
        );

        expect(styleOf('band')['opacity']).not.toBe(1);
        expect(Object.keys(firstTransform('band'))).toEqual(['translateY']);
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
