import { fireEvent, screen } from '@testing-library/react-native';

import { Icon } from '../icons/icon.tsx';
import { Text } from '../primitives/text.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { Accordion } from './accordion.tsx';
import { Avatar, ImagePlaceholder, initialsFrom, seedHash } from './avatar.tsx';
import { BADGE_TONES, Badge, NUTRITION_LEVELS } from './badge.tsx';
import { CALLOUT_TONES, Callout } from './callout.tsx';
import { CARD_TONES, Card } from './card.tsx';
import { Chip, FilterChip } from './chip.tsx';
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

    it.each(NUTRITION_LEVELS)(
        'gives the %s nutrition level a pattern as well as a colour',
        async (level) => {
            await renderWithI18n(<Badge testID={`n-${level}`} label={level} nutrition={level} />);
            const pattern = screen.getByTestId(`n-${level}-pattern`);
            expect(pattern.props['aria-hidden']).toBe(true);
            expect(String(pattern.children[0]).length).toBeGreaterThan(0);
        },
    );

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

describe('Chip', () => {
    it('is inert text when it does nothing', async () => {
        await renderWithI18n(<Chip testID="tag" label="Vegetarian" />);
        const node = screen.getByTestId('tag');

        expect(node.props.accessibilityRole).toBe('text');
        expect(node.props.onPress).toBeUndefined();
    });

    it('becomes a real button when it is activatable', async () => {
        const onPress = jest.fn();
        await renderWithI18n(<Chip testID="tag" label="Vegetarian" onPress={onPress} />);

        expect(screen.getByTestId('tag').props.accessibilityRole).toBe('button');
        await fireEvent.press(screen.getByTestId('tag'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    /** One target that both selects and deletes is unrecoverable by accident. */
    it('keeps the dismiss control separate from the chip body', async () => {
        const onPress = jest.fn();
        const onRemove = jest.fn();
        await renderWithI18n(
            <Chip testID="tag" label="Peanuts" onPress={onPress} onRemove={onRemove} />,
        );

        await fireEvent.press(screen.getByTestId('tag-activate'));
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(onRemove).not.toHaveBeenCalled();

        await fireEvent.press(screen.getByTestId('tag-remove'));
        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('names the dismiss control after what it removes', async () => {
        await renderWithI18n(<Chip testID="tag" label="Peanuts" onRemove={jest.fn()} />);
        expect(screen.getByTestId('tag-remove').props.accessibilityLabel).toBe('Remove Peanuts');
    });

    it('translates the dismiss control', async () => {
        await renderWithI18n(<Chip testID="tag" label="فول سوداني" onRemove={jest.fn()} />, 'ar');
        expect(screen.getByTestId('tag-remove').props.accessibilityLabel).toBe('إزالة فول سوداني');
    });

    /** Chips reflow, but never below the touch minimum both references fell short of. */
    it('holds the 44 dp touch minimum', async () => {
        await renderWithI18n(<Chip testID="tag" label="Vegetarian" onPress={jest.fn()} />);
        expect(screen.getByTestId('tag').props.className).toContain('min-h-touch');
    });

    it('does not fire while disabled', async () => {
        const onPress = jest.fn();
        await renderWithI18n(<Chip testID="tag" label="Vegetarian" onPress={onPress} disabled />);

        await fireEvent.press(screen.getByTestId('tag'));
        expect(onPress).not.toHaveBeenCalled();
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Chip testID="tag" label="نباتي" onPress={jest.fn()} onRemove={jest.fn()} />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('tag'));
    });
});

describe('FilterChip', () => {
    /**
     * `aria-selected` is invalid on a button and axe reports it; `aria-pressed` is the toggle-button
     * attribute the web actually accepts. `accessibilityState.selected` carries the same fact on
     * native, which react-native-web ignores entirely — so neither platform sees the other's.
     */
    it('announces selection as a pressed toggle', async () => {
        await renderWithI18n(
            <FilterChip testID="filter" label="High protein" selected onChange={jest.fn()} />,
        );

        const node = screen.getByTestId('filter');
        expect(node.props.accessibilityRole).toBe('button');
        expect(node.props['aria-pressed']).toBe(true);
        expect(node.props.accessibilityState).toMatchObject({ selected: true });
    });

    it('toggles on press', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <FilterChip
                testID="filter"
                label="High protein"
                selected={false}
                onChange={onChange}
            />,
        );

        await fireEvent.press(screen.getByTestId('filter'));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    /** Selection is never carried by colour alone. */
    it('adds a check mark when selected', async () => {
        await renderWithI18n(
            <FilterChip testID="filter" label="High protein" selected onChange={jest.fn()} />,
        );
        expect(screen.getByTestId('filter-check')).toBeTruthy();

        await renderWithI18n(
            <FilterChip testID="off" label="High protein" selected={false} onChange={jest.fn()} />,
        );
        expect(screen.queryByTestId('off-check')).toBeNull();
    });

    it('shows a result count when it has one', async () => {
        await renderWithI18n(
            <FilterChip
                testID="filter"
                label="High protein"
                selected={false}
                count={18}
                onChange={jest.fn()}
            />,
        );
        expect(screen.getByTestId('filter-count')).toHaveTextContent('18');
    });
});

describe('Callout', () => {
    it('is a note by default — standing guidance, not an interruption', async () => {
        await renderWithI18n(
            <Callout testID="note" title="Prototype data" body="Nothing here is real." />,
        );

        const node = screen.getByTestId('note');
        expect(node.props.role).toBe('note');
        expect(node.props.accessibilityRole).toBeUndefined();
        expect(screen.getByTestId('note-body')).toHaveTextContent('Nothing here is real.');
    });

    it('can interrupt when it genuinely must', async () => {
        await renderWithI18n(
            <Callout testID="alarm" role="alert" tone="danger" title="Allergen" />,
        );

        expect(screen.getByTestId('alarm').props.role).toBe('alert');
        expect(screen.getByTestId('alarm').props.accessibilityRole).toBe('alert');
    });

    it.each(CALLOUT_TONES)('pairs the %s tone with an icon, never colour alone', async (tone) => {
        await renderWithI18n(<Callout testID={`c-${tone}`} tone={tone} title={tone} />);
        expect(screen.getByTestId(`c-${tone}-icon`)).toBeTruthy();
    });

    it('lets a caller drop the icon when the title is unambiguous', async () => {
        await renderWithI18n(<Callout testID="plain" title="Heads up" icon={null} />);
        expect(screen.queryByTestId('plain-icon')).toBeNull();
    });

    it('renders its actions', async () => {
        await renderWithI18n(
            <Callout testID="note" title="Review" actions={<Text testID="act">Request</Text>} />,
        );
        expect(screen.getByTestId('note-actions')).toBeTruthy();
        expect(screen.getByTestId('act')).toBeTruthy();
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(<Callout testID="note" title="تنبيه" body="نص" />, 'ar');
        assertSubtreeIsLogical(screen.getByTestId('note'));
    });
});

describe('Accordion', () => {
    const items = [
        {
            key: 'a',
            title: 'What is a synthetic fixture?',
            children: <Text testID="body-a">A</Text>,
        },
        {
            key: 'b',
            title: 'Where do the figures come from?',
            children: <Text testID="body-b">B</Text>,
        },
    ];

    it('gives every header aria-expanded and a panel it controls', async () => {
        await renderWithI18n(<Accordion testID="faq" items={items} />);

        const header = screen.getByTestId('faq-a-header');
        expect(header.props.accessibilityRole).toBe('button');
        expect(header.props['aria-controls']).toBe('faq-a-panel');
        expect(header.props.accessibilityState).toMatchObject({ expanded: false });
        expect(screen.getByTestId('faq-a-panel').props.role).toBe('region');
    });

    it('opens a panel on press and mounts its content', async () => {
        await renderWithI18n(<Accordion testID="faq" items={items} />);
        expect(screen.queryByTestId('body-a')).toBeNull();

        await fireEvent.press(screen.getByTestId('faq-a-header'));
        expect(screen.getByTestId('faq-a-header').props.accessibilityState).toMatchObject({
            expanded: true,
        });
        expect(screen.getByTestId('body-a')).toBeTruthy();
    });

    it('closes the previous panel when only one may be open', async () => {
        await renderWithI18n(<Accordion testID="faq" items={items} defaultExpandedKeys={['a']} />);

        await fireEvent.press(screen.getByTestId('faq-b-header'));
        expect(screen.getByTestId('faq-b-header').props.accessibilityState).toMatchObject({
            expanded: true,
        });
        expect(screen.getByTestId('faq-a-header').props.accessibilityState).toMatchObject({
            expanded: false,
        });
    });

    it('keeps both open when asked to', async () => {
        await renderWithI18n(
            <Accordion testID="faq" items={items} defaultExpandedKeys={['a']} multiple />,
        );

        await fireEvent.press(screen.getByTestId('faq-b-header'));
        expect(screen.getByTestId('faq-a-header').props.accessibilityState).toMatchObject({
            expanded: true,
        });
        expect(screen.getByTestId('faq-b-header').props.accessibilityState).toMatchObject({
            expanded: true,
        });
    });

    it('reports every change to a controlled caller without moving on its own', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <Accordion testID="faq" items={items} expandedKeys={[]} onChange={onChange} />,
        );

        await fireEvent.press(screen.getByTestId('faq-b-header'));
        expect(onChange).toHaveBeenCalledWith(['b']);
        expect(screen.getByTestId('faq-b-header').props.accessibilityState).toMatchObject({
            expanded: false,
        });
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Accordion
                testID="faq"
                items={[{ key: 'a', title: 'سؤال', children: <Text>جواب</Text> }]}
                defaultExpandedKeys={['a']}
            />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('faq'));
    });
});

describe('Avatar', () => {
    it('is an image named after the person', async () => {
        await renderWithI18n(<Avatar testID="who" name="Nour Saleh" />);

        const node = screen.getByTestId('who');
        expect(node.props.accessibilityRole).toBe('image');
        expect(node.props.accessibilityLabel).toBe('Nour Saleh');
    });

    it('takes initials by code point, so a non-Latin script is not split', () => {
        expect(initialsFrom('Nour Saleh')).toBe('NS');
        expect(initialsFrom('Verdant')).toBe('V');
        expect(initialsFrom('نور صالح')).toBe('نص');
        expect(initialsFrom('   ')).toBe('');
    });

    /** The same kitchen must look the same on every device and in every session. */
    it('derives a stable surface from the seed', () => {
        expect(seedHash('verdant-kitchen')).toBe(seedHash('verdant-kitchen'));
        expect(seedHash('verdant-kitchen')).not.toBe(seedHash('harvest-table'));
    });

    it('lets an id hold the colour steady across a rename', async () => {
        const first = await renderWithI18n(<Avatar testID="a" name="Old name" seed="kitchen-01" />);
        const before = first.getByTestId('a').props.className;

        const second = await renderWithI18n(
            <Avatar testID="b" name="New name" seed="kitchen-01" />,
        );
        expect(second.getByTestId('b').props.className).toBe(before);
    });
});

describe('ImagePlaceholder', () => {
    it('is a described image, never a remote one', async () => {
        await renderWithI18n(
            <ImagePlaceholder testID="ph" seed="meal-01" label="Image not available" />,
        );

        const node = screen.getByTestId('ph');
        expect(node.props.accessibilityRole).toBe('image');
        expect(node.props.accessibilityLabel).toBe('Image not available');
        expect(JSON.stringify(node.props.className)).not.toMatch(/https?:/);
    });

    it('hides its generated pattern from assistive technology', async () => {
        await renderWithI18n(<ImagePlaceholder testID="ph" seed="meal-01" label="Meal" />);
        expect(screen.getByTestId('ph-pattern').props['aria-hidden']).toBe(true);
    });

    it('varies the pattern across seeds so a grid does not look repetitive', async () => {
        const first = await renderWithI18n(
            <ImagePlaceholder testID="a" seed="meal-01" label="A" />,
        );
        const second = await renderWithI18n(
            <ImagePlaceholder testID="b" seed="meal-27" label="B" />,
        );

        expect(String(first.getByTestId('a-pattern').children[0])).not.toBe(
            String(second.getByTestId('b-pattern').children[0]),
        );
    });
});
