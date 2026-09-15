import { CONTROL_SIZES, controlHeight, rowHeight } from '@healthy360/design-tokens';
import { screen } from '@testing-library/react-native';

import { Badge } from './content/badge.tsx';
import { DataList } from './content/data-list.tsx';
import { DensityProvider } from './hooks/use-density.tsx';
import { Button } from './actions/button.tsx';
import { Icon } from './icons/icon.tsx';
import { IconButton } from './actions/icon-button.tsx';
import { QuantityInput } from './forms/quantity-input.tsx';
import { SearchInput } from './forms/search-input.tsx';
import { TextInputField } from './forms/text-input.tsx';
import { renderWithI18n } from './testing/render.tsx';
import type { ReactNode } from 'react';

/**
 * The control-height gate (handoff §2, §9).
 *
 * Every Catalogue control resolves its height from `control.ts` and from nothing else. That is the
 * single knob density turns, and it only stays single if no component quietly grows its own: a
 * `py-2` here and a `min-h-touch` there is how a "32px admin" became a 44px one last time.
 *
 * ## Why this asserts on class names
 *
 * NativeWind resolves `className` through the Metro CSS pipeline, which does not run under Jest, so
 * the class string arrives at the rendered node untouched — `testing/render.tsx` makes the same
 * argument for the RTL assertions. That makes the class the honest artefact: `h-control-sm` is
 * exactly what NativeWind will compile, and the preset is what turns it into 28px. The membership
 * check below closes the loop by requiring the suffix to name a real `controlHeight` key, so a
 * `h-control-xl` that no token backs fails here rather than silently compiling to nothing.
 */

/** `h-control-sm` → 28. Returns `null` for a class that names no height at all. */
function resolveControlHeight(className: unknown): number | null {
    if (typeof className !== 'string') return null;
    const match = /(?:^|\s)h-control-([a-z]+)(?:$|\s)/.exec(className);
    if (match === null) return null;
    const size = match[1] as keyof typeof controlHeight;
    return controlHeight[size] ?? null;
}

/**
 * `min-h-row-sm` → 28.
 *
 * A floor rather than a fixed height: a cell whose value outgrows its track wraps and takes the row
 * with it instead of clipping mid-word. What the ladder still owns is where a row *starts*, which
 * is what this asserts — the suffix must name a real `rowHeight` key, so a density that resolved to
 * nothing fails here.
 */
function resolveRowHeight(className: unknown): number | null {
    if (typeof className !== 'string') return null;
    const match = /(?:^|\s)min-h-row-([a-z]+)(?:$|\s)/.exec(className);
    if (match === null) return null;
    const size = match[1] as keyof typeof rowHeight;
    return rowHeight[size] ?? null;
}

function compact(node: ReactNode) {
    return <DensityProvider value="compact">{node}</DensityProvider>;
}

const HEIGHTS = Object.values(controlHeight);

describe('control heights', () => {
    it.each(CONTROL_SIZES.filter((size) => size !== 'xs'))(
        'Button at size=%s resolves to a controlHeight member',
        async (size) => {
            await renderWithI18n(
                compact(
                    <Button
                        testID="control"
                        label="Save"
                        size={size as 'sm' | 'md' | 'lg'}
                        onPress={() => undefined}
                    />,
                ),
            );

            const resolved = resolveControlHeight(screen.getByTestId('control').props.className);
            expect(resolved).toBe(controlHeight[size]);
            expect(HEIGHTS).toContain(resolved);
        },
    );

    it('IconButton takes the same ladder as Button', async () => {
        await renderWithI18n(
            compact(
                <IconButton
                    testID="control"
                    icon={<Icon name="more" size="sm" />}
                    label="More"
                    onPress={() => undefined}
                />,
            ),
        );

        expect(HEIGHTS).toContain(
            resolveControlHeight(screen.getByTestId('control').props.className),
        );
    });

    it.each(['sm', 'md', 'lg'] as const)(
        'TextInputField at size=%s frames itself on the ladder',
        async (size) => {
            await renderWithI18n(
                compact(<TextInputField testID="field" label="Designation" size={size} />),
            );

            // The frame is the sized box, not the field wrapper: the label and helper sit outside
            // it, and a ladder that included them would make "32px control" mean a 60px stack.
            const frame = screen.getByTestId('field-input').parent;
            expect(HEIGHTS).toContain(resolveControlHeight(frame?.props.className));
        },
    );

    it('SearchInput is a 28px control — the toolbar row height', async () => {
        await renderWithI18n(
            compact(<SearchInput testID="search" value="" onChangeText={() => undefined} />),
        );

        expect(resolveControlHeight(screen.getByTestId('search').props.className)).toBe(
            controlHeight.sm,
        );
    });

    it('QuantityInput frames on the ladder like every other field', async () => {
        await renderWithI18n(
            compact(
                <QuantityInput
                    testID="qty"
                    label="Yield"
                    unit="kg"
                    value="1.7"
                    onChangeText={() => undefined}
                />,
            ),
        );

        const frame = screen.getByTestId('qty-input').parent;
        expect(HEIGHTS).toContain(resolveControlHeight(frame?.props.className));
    });

    it.each(['sm', 'md', 'lg'] as const)(
        'DataList rows at density=%s resolve to a rowHeight member',
        async (density) => {
            await renderWithI18n(
                compact(
                    <DataList
                        testID="list"
                        label="Ingredients"
                        density={density}
                        rows={[{ id: 'a', name: 'Tahini' }]}
                        rowKey={(row) => row.id}
                        columns={[
                            {
                                key: 'name',
                                label: 'Designation',
                                width: 240,
                                priority: 100,
                                value: (row) => row.name,
                            },
                        ]}
                    />,
                ),
            );

            expect(resolveRowHeight(screen.getByTestId('list-row-a').props.className)).toBe(
                rowHeight[density],
            );
        },
    );

    it('no compact control carries the retired 44px touch floor', async () => {
        await renderWithI18n(
            compact(
                <>
                    <Button testID="button" label="New" onPress={() => undefined} />
                    <SearchInput testID="search" value="" onChangeText={() => undefined} />
                    <Badge testID="badge" label="Draft" tone="warning" />
                </>,
            ),
        );

        // `MIN_TOUCH_TARGET` is retired as a token but the utilities survive for the phone
        // surfaces, so the thing to assert is that the *admin* ladder never reaches for them —
        // not that they stopped existing.
        for (const id of ['button', 'search', 'badge']) {
            expect(screen.getByTestId(id).props.className).not.toMatch(/min-[hw]-touch/);
        }
    });
});
