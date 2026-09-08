import { CONTROL_SIZES, controlHeight } from '@healthy360/design-tokens';
import { screen } from '@testing-library/react-native';

import { Button } from '../actions/button.tsx';
import { IconButton } from '../actions/icon-button.tsx';
import { Badge } from '../content/badge.tsx';
import { Card } from '../content/card.tsx';
import { Checkbox } from '../forms/checkbox.tsx';
import { TextInputField } from '../forms/text-input.tsx';
import { Icon } from '../icons/icon.tsx';
import { Breadcrumbs } from '../navigation/breadcrumbs.tsx';
import { Tabs } from '../navigation/tabs.tsx';
import { Text } from '../primitives/text.tsx';
import { renderWithI18n } from '../testing/render.tsx';
import { DensityProvider } from './use-density.tsx';
import type { ReactElement } from 'react';

/**
 * The density contract.
 *
 * Two things are asserted here and they pull in opposite directions, which is exactly why they are
 * asserted together in one file:
 *
 * 1. Under `compact`, every control's height is a member of `controlHeight` — the handoff's §2 gate.
 *    A component that reaches for `py-2` or an arbitrary value fails this, because the class it
 *    emits is not one of the four the token generates.
 * 2. Under `comfortable` — the default, and what the customer app renders — nothing changed. The
 *    44px floor is still there and the admin faces are absent. This half of the file is the reason
 *    the ladder could be introduced at all.
 */

const CONTROL_HEIGHT_CLASSES = CONTROL_SIZES.map((size) => `h-control-${size}`);

/** Every height class the token can legitimately produce, as a matcher. */
const HEIGHT_CLASS_PATTERN = new RegExp(`\\b(?:${CONTROL_HEIGHT_CLASSES.join('|')})\\b`);

async function renderCompact(node: ReactElement) {
    return renderWithI18n(<DensityProvider value="compact">{node}</DensityProvider>);
}

const BREADCRUMB_ITEMS = [
    { key: 'root', label: 'Catalogue', onPress: jest.fn(), testID: 'crumb-root' },
    { key: 'here', label: 'Ingredients', testID: 'crumb-here' },
];

const TAB_ITEMS = [
    { value: 'description', label: 'Description', testID: 'tab-description' },
    { value: 'production', label: 'Production', testID: 'tab-production' },
];

describe('compact density', () => {
    it.each(['sm', 'md', 'lg'] as const)(
        'sizes a %s button from controlHeight and nothing else',
        async (size) => {
            await renderCompact(
                <Button testID="save" label="Save" size={size} onPress={jest.fn()} />,
            );
            const classes: string = screen.getByTestId('save').props.className;

            expect(classes).toContain(`h-control-${size}`);
            // No touch floor, and no padding-derived height competing with the token.
            expect(classes).not.toContain('min-h-touch');
            expect(classes).not.toMatch(/\bpy-/);
        },
    );

    it.each(['sm', 'md', 'lg'] as const)('sizes a %s icon button square on the ladder', async (size) => {
        await renderCompact(
            <IconButton
                testID="more"
                label="More"
                size={size}
                icon={<Icon name="more" size="sm" />}
                onPress={jest.fn()}
            />,
        );
        const classes: string = screen.getByTestId('more').props.className;

        // Square from the aspect ratio, not from a width — see the note in `icon-button.tsx`.
        expect(classes).toContain(`h-control-${size}`);
        expect(classes).toContain('aspect-square');
        expect(classes).not.toMatch(/\bw-\d/);
    });

    it('sizes the input frame from the ladder', async () => {
        await renderCompact(<TextInputField testID="ref" label="Reference" size="sm" />);
        const frame: string = screen.getByTestId('ref-input').parent?.props.className ?? '';

        expect(frame).toMatch(HEIGHT_CLASS_PATTERN);
        expect(frame).not.toContain('min-h-touch');
    });

    it('sets a control corner on controls and a panel corner on panels', async () => {
        await renderCompact(
            <>
                <Button testID="save" label="Save" onPress={jest.fn()} />
                <Card testID="panel">
                    <Text>Body</Text>
                </Card>
            </>,
        );

        // 4px controls, 8px panels — the two radii §1.3 allows.
        expect(screen.getByTestId('save').props.className).toContain('rounded-sm');
        const panel: string = screen.getByTestId('panel').props.className;
        expect(panel).toMatch(/\brounded\b/);
        expect(panel).not.toContain('rounded-xl');
    });

    it('leaves a card flat — the admin has no card elevation', async () => {
        await renderCompact(
            <Card testID="panel" tone="raised" interactive onPress={jest.fn()}>
                <Text>Body</Text>
            </Card>,
        );
        const classes: string = screen.getByTestId('panel').props.className;

        expect(classes).not.toContain('shadow-elevation');
    });

    it('sizes a tab on the ladder', async () => {
        await renderCompact(
            <Tabs
                testID="tabs"
                label="Recipe"
                items={TAB_ITEMS}
                value="description"
                onChange={jest.fn()}
            />,
        );
        expect(screen.getByTestId('tab-description').props.className).toMatch(HEIGHT_CLASS_PATTERN);
    });

    it('sizes a breadcrumb link on the ladder', async () => {
        await renderCompact(<Breadcrumbs testID="trail" items={BREADCRUMB_ITEMS} />);
        const classes: string = screen.getByTestId('crumb-root').props.className;

        expect(classes).toMatch(HEIGHT_CLASS_PATTERN);
        expect(classes).not.toContain('min-h-touch');
    });

    it('drops the touch floor from the checkbox row', async () => {
        await renderCompact(
            <Checkbox testID="restricted" checked={false} onChange={jest.fn()} label="Restricted" />,
        );
        expect(screen.getByTestId('restricted-control').props.className).not.toContain(
            'min-h-touch',
        );
    });

    it.each(['micro', 'caption', 'body', 'label', 'strong', 'section', 'title', 'display'] as const)(
        'renders %s on the role ramp in the admin face',
        async (variant) => {
            await renderCompact(
                <Text testID="copy" variant={variant}>
                    Zaatar
                </Text>,
            );
            const classes: string = screen.getByTestId('copy').props.className;

            expect(classes).toContain(`text-role-${variant.toLowerCase()}`);
            expect(classes).toContain('font-admin');
        },
    );

    it('leaves the mono role to IBM Plex Mono rather than stacking two families', async () => {
        await renderCompact(
            <Text testID="price" variant="mono">
                12.500
            </Text>,
        );
        const classes: string = screen.getByTestId('price').props.className;

        expect(classes).toContain('font-mono');
        expect(classes).not.toContain('font-admin');
    });

    it('keeps a badge a pill — the one exception the radius rule grants', async () => {
        await renderCompact(<Badge testID="status" label="Draft" tone="warning" />);
        expect(screen.getByTestId('status').props.className).toContain('rounded-full');
    });
});

describe('comfortable density', () => {
    it('is the default, so a customer control needs no provider to keep its floor', async () => {
        await renderWithI18n(<Button testID="order" label="Order" onPress={jest.fn()} />);
        const classes: string = screen.getByTestId('order').props.className;

        expect(classes).toContain('min-h-touch');
        expect(classes).not.toMatch(HEIGHT_CLASS_PATTERN);
    });

    it.each(['sm', 'md', 'lg'] as const)('keeps the %s touch floor on every size', async (size) => {
        await renderWithI18n(
            <Button testID="order" label="Order" size={size} onPress={jest.fn()} />,
        );
        expect(screen.getByTestId('order').props.className).toContain('min-h-touch');
    });

    it('never asks the customer app for the admin faces', async () => {
        // Schibsted Grotesk is admin-only: the customer app must not load a face it does not
        // render, and `font-admin` in customer output is how that regression would arrive.
        await renderWithI18n(
            <>
                <Text testID="copy">Body</Text>
                <Button testID="order" label="Order" onPress={jest.fn()} />
                <Breadcrumbs testID="trail" items={BREADCRUMB_ITEMS} />
            </>,
        );

        for (const id of ['copy', 'order', 'crumb-root']) {
            expect(screen.getByTestId(id).props.className).not.toContain('font-admin');
        }
    });

    it('keeps the card lift, which is a customer affordance', async () => {
        await renderWithI18n(
            <Card testID="meal" tone="raised" interactive onPress={jest.fn()}>
                <Text>Body</Text>
            </Card>,
        );
        expect(screen.getByTestId('meal').props.className).toContain('shadow-elevation-card');
    });
});

describe('controlHeight', () => {
    it('has a class for every size the token declares', () => {
        // Guards the direction this file cannot otherwise see: a fifth size added to `control.ts`
        // without a matching utility would leave the assertions above quietly checking four of five.
        expect(Object.keys(controlHeight).sort()).toEqual([...CONTROL_SIZES].sort());
    });
});
