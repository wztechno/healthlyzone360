import { screen } from '@testing-library/react-native';

import { DensityProvider } from '../hooks/use-density.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { Inline, Stack } from './stack.tsx';
import { Heading, Text } from './text.tsx';

describe('Text', () => {
    it('renders its children and defaults to logical start alignment', async () => {
        await renderWithI18n(<Text testID="body">Nutrition, clinics and kitchens</Text>);
        const node = screen.getByTestId('body');

        expect(node).toHaveTextContent('Nutrition, clinics and kitchens');
        expect(node.props.className).toContain('text-start');
        expect(node.props.className).toContain('text-content-primary');
    });

    it.each(['start', 'end', 'center'] as const)(
        'maps align=%s to a logical utility',
        async (align) => {
            await renderWithI18n(
                <Text testID="aligned" align={align}>
                    text
                </Text>,
            );
            expect(screen.getByTestId('aligned').props.className).toContain(`text-${align}`);
        },
    );

    it.each(['secondary', 'danger', 'success'] as const)(
        'maps tone=%s to a token class',
        async (tone) => {
            await renderWithI18n(
                <Text testID="toned" tone={tone}>
                    text
                </Text>,
            );
            expect(screen.getByTestId('toned').props.className).toMatch(/^text-|\stext-/);
        },
    );

    it('appends the caller className last so it can win', async () => {
        await renderWithI18n(
            <Text testID="custom" className="text-2xl">
                text
            </Text>,
        );
        expect(screen.getByTestId('custom').props.className.endsWith('text-2xl')).toBe(true);
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(<Text testID="logical">text</Text>);
        assertSubtreeIsLogical(screen.getByTestId('logical'));
    });

    it('renders Arabic copy without switching to a physical alignment', async () => {
        await renderWithI18n(<Text testID="arabic">التغذية والعيادات والمطابخ</Text>, 'ar');
        const node = screen.getByTestId('arabic');
        expect(node).toHaveTextContent('التغذية والعيادات والمطابخ');
        assertSubtreeIsLogical(node);
    });

    /*
     * The regression this whole pass guards.
     *
     * The product used to draw one demoted label in five shapes: `micro`; `label` with
     * `uppercase tracking-widest`; `caption` with the same; a hand-written
     * `text-xs font-bold uppercase tracking-widest`; and the `section` step — across four Latin
     * faces. `micro` is the one step for the job, and nothing on it shouts.
     */
    it.each(['micro', 'section'] as const)(
        'sets the %s step in sentence case, in both densities',
        async (variant) => {
            await renderWithI18n(
                <DensityProvider value="compact">
                    <Text testID="compact" variant={variant}>
                        Production item
                    </Text>
                </DensityProvider>,
            );
            expect(screen.getByTestId('compact').props.className).not.toContain('uppercase');

            await renderWithI18n(
                <Text testID="comfortable" variant={variant}>
                    Production item
                </Text>,
            );
            expect(screen.getByTestId('comfortable').props.className).not.toContain('uppercase');
        },
    );

    it('names no family on any variant, and asks only the figure for tabular digits', async () => {
        await renderWithI18n(
            <DensityProvider value="compact">
                <Text testID="eyebrow" variant="micro">
                    Allergens
                </Text>
                <Text testID="label" variant="label">
                    Name
                </Text>
                <Text testID="figure" variant="mono">
                    12.40
                </Text>
            </DensityProvider>,
        );

        // No variant names a family — there is one, set on `html` per script. The figure differs
        // by asking for fixed-advance digits, not by asking for a different typeface.
        for (const id of ['eyebrow', 'label', 'figure']) {
            const classes: string = screen.getByTestId(id).props.className;
            for (const face of ['font-admin', 'font-display', 'font-mono']) {
                expect(classes).not.toContain(face);
            }
        }
        expect(screen.getByTestId('figure').props.className).toContain('tabular-nums');
        expect(screen.getByTestId('eyebrow').props.className).not.toContain('tabular-nums');
    });
});

describe('Heading', () => {
    it('is announced as a header with an explicit level', async () => {
        await renderWithI18n(
            <Heading testID="h" level={1}>
                Your workspace
            </Heading>,
        );
        const node = screen.getByTestId('h');

        expect(node.props.accessibilityRole).toBe('header');
        expect(node.props['aria-level']).toBe(1);
    });

    it.each([1, 2, 3, 4] as const)('carries aria-level=%s', async (level) => {
        await renderWithI18n(
            <Heading testID={`h${level}`} level={level}>
                Heading
            </Heading>,
        );
        expect(screen.getByTestId(`h${level}`).props['aria-level']).toBe(level);
    });

    it('defaults to level 2 rather than an unlevelled heading', async () => {
        await renderWithI18n(<Heading testID="default">Heading</Heading>);
        expect(screen.getByTestId('default').props['aria-level']).toBe(2);
    });
});

describe('Stack and Inline', () => {
    it('space children with direction-neutral gap utilities', async () => {
        await renderWithI18n(
            <Stack testID="stack" space="lg">
                <Text>one</Text>
            </Stack>,
        );
        const node = screen.getByTestId('stack');

        expect(node.props.className).toContain('flex-col');
        expect(node.props.className).toContain('gap-6');
        assertSubtreeIsLogical(node);
    });

    it('Inline lays out a wrapping row with logical cross-axis alignment', async () => {
        await renderWithI18n(
            <Inline testID="inline" align="start" justify="between">
                <Text>one</Text>
                <Text>two</Text>
            </Inline>,
        );
        const node = screen.getByTestId('inline');

        expect(node.props.className).toContain('flex-row');
        expect(node.props.className).toContain('flex-wrap');
        expect(node.props.className).toContain('items-start');
        expect(node.props.className).toContain('justify-between');
        assertSubtreeIsLogical(node);
    });

    it('Inline can be told not to wrap', async () => {
        await renderWithI18n(
            <Inline testID="nowrap" wrap={false}>
                <Text>one</Text>
            </Inline>,
        );
        expect(screen.getByTestId('nowrap').props.className).toContain('flex-nowrap');
    });

    it('grow adds flex-1 rather than a width', async () => {
        await renderWithI18n(
            <Stack testID="grow" grow>
                <Text>one</Text>
            </Stack>,
        );
        expect(screen.getByTestId('grow').props.className).toContain('flex-1');
    });
});
