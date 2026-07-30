import { fireEvent, screen } from '@testing-library/react-native';

import { Icon } from '../icons/icon.tsx';
import { Text } from '../primitives/text.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { BADGE_TONES, Badge, NUTRITION_LEVELS } from './badge.tsx';
import { CARD_TONES, Card } from './card.tsx';
import { ListItem } from './list-item.tsx';

describe('Card', () => {
    it('is a plain grouping element when it does nothing', async () => {
        await renderWithI18n(
            <Card testID="plain">
                <Text>Body</Text>
            </Card>,
        );
        const node = screen.getByTestId('plain');

        expect(node.props.accessibilityRole).toBeUndefined();
        expect(node.props.onPress).toBeUndefined();
    });

    it('becomes a real button when it is activatable', async () => {
        const onPress = jest.fn();
        await renderWithI18n(
            <Card testID="pressable" title="Cedar Clinic" onPress={onPress}>
                <Text>Body</Text>
            </Card>,
        );
        const node = screen.getByTestId('pressable');

        expect(node.props.accessibilityRole).toBe('button');
        expect(node.props.accessibilityLabel).toBe('Cedar Clinic');
        await fireEvent.press(node);
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('renders its title as a level-3 header', async () => {
        await renderWithI18n(
            <Card testID="titled" title="Devices" subtitle="Where you are signed in">
                <Text>Body</Text>
            </Card>,
        );
        expect(screen.getByTestId('titled')).toHaveTextContent(/Devices/);
        expect(screen.getByTestId('titled')).toHaveTextContent(/Where you are signed in/);
    });

    it.each(CARD_TONES)('renders the %s tone from tokens', async (tone) => {
        await renderWithI18n(
            <Card testID={`tone-${tone}`} tone={tone}>
                <Text>Body</Text>
            </Card>,
        );
        expect(screen.getByTestId(`tone-${tone}`).props.className).toMatch(/bg-|border/);
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Card testID="logical" title="عيادة الأرز">
                <Text>محتوى</Text>
            </Card>,
        );
        assertSubtreeIsLogical(screen.getByTestId('logical'));
    });
});

describe('ListItem', () => {
    it('places leading and trailing slots around the text in source order', async () => {
        await renderWithI18n(
            <ListItem
                testID="row"
                title="Cedar Clinic"
                description="2 branches"
                leading={<Icon name="organisation" />}
                trailing={<Badge label="Active" tone="success" />}
                chevron
                onPress={jest.fn()}
            />,
        );

        const testIDs = screen
            .getByTestId('row')
            .children.map((child) =>
                typeof child === 'object' && child !== null && 'props' in child
                    ? ((child.props as { testID?: string }).testID ?? null)
                    : null,
            );

        expect(testIDs).toEqual(['row-leading', null, 'row-trailing', 'row-chevron']);
    });

    it('flips the chevron glyph for Arabic rather than mirroring a style', async () => {
        const english = await renderWithI18n(
            <ListItem testID="row" title="Cedar Clinic" chevron onPress={jest.fn()} />,
            'en',
        );
        expect(english.getByTestId('row-chevron')).toHaveTextContent('›');
    });

    it('renders the Arabic chevron pointing the other way', async () => {
        await renderWithI18n(
            <ListItem testID="row" title="عيادة الأرز" chevron onPress={jest.fn()} />,
            'ar',
        );
        expect(screen.getByTestId('row-chevron')).toHaveTextContent('‹');
    });

    it('is a button when pressable and a plain row otherwise', async () => {
        const view = await renderWithI18n(<ListItem testID="static" title="Read only" />);
        expect(view.getByTestId('static').props.accessibilityRole).toBeUndefined();
    });

    it('reports its selected state', async () => {
        await renderWithI18n(
            <ListItem testID="row" title="Cedar Clinic" selected onPress={jest.fn()} />,
        );
        expect(screen.getByTestId('row').props.accessibilityState).toMatchObject({
            selected: true,
        });
    });

    it('does not fire when disabled', async () => {
        const onPress = jest.fn();
        await renderWithI18n(
            <ListItem testID="row" title="Cedar Clinic" disabled onPress={onPress} />,
        );
        await fireEvent.press(screen.getByTestId('row'));
        expect(onPress).not.toHaveBeenCalled();
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <ListItem
                testID="logical"
                title="Cedar Clinic"
                leading={<Icon name="organisation" />}
                chevron
                onPress={jest.fn()}
            />,
        );
        assertSubtreeIsLogical(screen.getByTestId('logical'));
    });
});

describe('Badge', () => {
    it('names itself for assistive technology', async () => {
        await renderWithI18n(<Badge testID="badge" label="Suspended" tone="warning" />);
        expect(screen.getByTestId('badge').props.accessibilityLabel).toBe('Suspended');
    });

    /** WCAG 1.4.1: colour must never be the only carrier of meaning. */
    it.each(BADGE_TONES.filter((tone) => tone !== 'neutral'))(
        'pairs the %s tone with an icon, not just a colour',
        async (tone) => {
            await renderWithI18n(<Badge testID={`b-${tone}`} label="Status" tone={tone} />);
            expect(screen.getByTestId(`b-${tone}-icon`)).toBeTruthy();
        },
    );

    it('lets a caller drop the icon explicitly when the label is unambiguous', async () => {
        await renderWithI18n(<Badge testID="plain" label="3 branches" tone="info" icon={null} />);
        expect(screen.queryByTestId('plain-icon')).toBeNull();
    });

    it.each(NUTRITION_LEVELS)('gives the %s nutrition level a pattern as well as a colour', async (
        level,
    ) => {
        await renderWithI18n(
            <Badge testID={`n-${level}`} label={level} nutrition={level} />,
        );
        const pattern = screen.getByTestId(`n-${level}-pattern`);
        expect(pattern.props['aria-hidden']).toBe(true);
        expect(String(pattern.children[0]).length).toBeGreaterThan(0);
    });

    it('gives each nutrition level a distinct number of marks, so the scale is ordinal', async () => {
        const lengths: number[] = [];
        for (const level of NUTRITION_LEVELS) {
            const view = await renderWithI18n(
                <Badge testID={`len-${level}`} label={level} nutrition={level} />,
            );
            lengths.push(String(view.getByTestId(`len-${level}-pattern`).children[0]).length);
        }
        expect(lengths).toEqual([1, 2, 3, 4, 5]);
    });
});
