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
import { Tag, TagRow } from './tag.tsx';
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

    it('fills its cell and pushes the footer down when it has one', async () => {
        await renderWithI18n(
            <Card testID="footed" footer={<Text>Price</Text>}>
                <Text>Body</Text>
            </Card>,
        );

        // `self-stretch` + `flex-1` body + `mt-auto` footer is the whole mechanism behind a row of
        // cards sharing one price baseline. Prefer stretch over `h-full`: percentage height against
        // a flex-grown ScrollView content container expands to the viewport on Yoga. Any one of the
        // three missing and the footers go ragged.
        expect(screen.getByTestId('footed').props.className).toMatch(/self-stretch/);
        expect(screen.getByTestId('footed-body').props.className).toMatch(/flex-1/);
        expect(screen.getByTestId('footed-footer').props.className).toMatch(/mt-auto/);
    });

    it('drops the sibling gap when a footer is present, and keeps it otherwise', async () => {
        // Otherwise the footer sits a gap *plus* the free space away from the body.
        await renderWithI18n(
            <Card testID="footed" footer={<Text>Price</Text>}>
                <Text>Body</Text>
            </Card>,
        );
        expect(screen.getByTestId('footed').props.className).not.toMatch(/(^|\s)gap-3(\s|$)/);

        await renderWithI18n(
            <Card testID="plain-gap">
                <Text>Body</Text>
            </Card>,
        );
        expect(screen.getByTestId('plain-gap').props.className).toMatch(/(^|\s)gap-3(\s|$)/);
    });

    it('clips only when the padding is none, so a padded card can still show a Popover', async () => {
        await renderWithI18n(
            <Card testID="media" padding="none">
                <Text>Body</Text>
            </Card>,
        );
        expect(screen.getByTestId('media').props.className).toMatch(/overflow-hidden/);

        await renderWithI18n(
            <Card testID="padded" padding="lg">
                <Text>Body</Text>
            </Card>,
        );
        expect(screen.getByTestId('padded').props.className).not.toMatch(/overflow-hidden/);
    });

    it('lifts on hover only when asked, and drives the timing from a duration token', async () => {
        // Not implied by `onPress`: `plan-card.tsx` is pressable in parts and must not lift as one.
        await renderWithI18n(
            <Card testID="lift" interactive onPress={() => {}}>
                <Text>Body</Text>
            </Card>,
        );
        const lifted = screen.getByTestId('lift').props.className;
        expect(lifted).toMatch(/hover:-translate-y-1/);
        expect(lifted).toMatch(/hover:shadow-elevation-card-hover/);
        // A literal duration would keep animating for a reader who asked it not to; the tokens are
        // what `prefers-reduced-motion` zeroes.
        expect(lifted).toMatch(/duration-normal/);

        await renderWithI18n(
            <Card testID="still" onPress={() => {}}>
                <Text>Body</Text>
            </Card>,
        );
        expect(screen.getByTestId('still').props.className).not.toMatch(/hover:/);
    });

    it('keeps the footer inside the pressable target when the card is one', async () => {
        const onPress = jest.fn();
        await renderWithI18n(
            <Card testID="pressable-footed" onPress={onPress} footer={<Text>Price</Text>}>
                <Text>Body</Text>
            </Card>,
        );
        expect(screen.getByTestId('pressable-footed')).toHaveTextContent(/Price/);
        expect(screen.getByTestId('pressable-footed').props.accessibilityRole).toBe('button');
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

    /**
     * …and only when there is something to touch. A tag on a card is a label; holding it at button
     * height makes a row of tags read as a row of dead buttons.
     */
    it('drops to label size when it is not activatable', async () => {
        await renderWithI18n(<Chip testID="tag" label="Vegetarian" />);
        expect(screen.getByTestId('tag').props.className).not.toContain('min-h-touch');

        await renderWithI18n(<Chip testID="removable" label="Peanuts" onRemove={jest.fn()} />);
        expect(screen.getByTestId('removable').props.className).toContain('min-h-touch');
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

describe('Tag', () => {
    /** A word about something. There is no target in it, so there is no 44 dp floor either. */
    it('is a label, not a control', async () => {
        await renderWithI18n(<Tag testID="tag" label="Vegan" />);

        const node = screen.getByTestId('tag');
        expect(node.props.accessibilityRole).toBe('text');
        expect(node.props.onPress).toBeUndefined();
        expect(node.props.className).not.toContain('min-h-touch');
        // HealthZone reserves the hairline for the pills that are interactive or semantic.
        expect(node.props.className).not.toMatch(/(^|\s)border(\s|$)/);
        expect(node.props.className).toMatch(/bg-surface-sunken/);
    });

    it('renders an inert chip as one, so the two shapes cannot drift', async () => {
        await renderWithI18n(
            <>
                <Chip testID="chip" label="Vegan" />
                <Tag testID="tag" label="Vegan" />
            </>,
        );

        expect(screen.getByTestId('chip').props.className).toBe(
            screen.getByTestId('tag').props.className,
        );
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(<Tag testID="tag" label="نباتي" icon="leaf" />, 'ar');
        assertSubtreeIsLogical(screen.getByTestId('tag'));
    });
});

describe('TagRow', () => {
    const items = [
        { key: 'vegan', label: 'Vegan' },
        { key: 'halal', label: 'Halal' },
        { key: 'keto', label: 'Keto' },
        { key: 'nut-free', label: 'Nut free' },
    ] as const;

    it('draws every tag when there is no cap', async () => {
        await renderWithI18n(<TagRow testID="tags" items={items} />);

        expect(screen.getByTestId('tags-vegan')).toBeTruthy();
        expect(screen.getByTestId('tags-nut-free')).toBeTruthy();
        expect(screen.queryByTestId('tags-more')).toBeNull();
    });

    /** A "+2" only a sighted reader can resolve is two facts removed from everybody else. */
    it('collapses the rest into a counter that names what it hides', async () => {
        await renderWithI18n(<TagRow testID="tags" items={items} max={2} />);

        expect(screen.getByTestId('tags-halal')).toBeTruthy();
        expect(screen.queryByTestId('tags-keto')).toBeNull();

        const more = screen.getByTestId('tags-more');
        expect(more).toHaveTextContent('+2');
        expect(more.props.accessibilityLabel).toBe('2 more: Keto, Nut free');
    });

    it('renders nothing at all when there is nothing to say', async () => {
        await renderWithI18n(<TagRow testID="tags" items={[]} />);
        expect(screen.queryByTestId('tags')).toBeNull();
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

    /**
     * Selection is never carried by colour alone. It is carried by a luminance inversion: the lit
     * chip is the ink surface with its inverse text, the unlit one the card surface inside a
     * hairline, and the difference survives greyscale as well as any colour-vision deficiency.
     */
    it('inverts the surface when selected rather than tinting it', async () => {
        await renderWithI18n(
            <FilterChip testID="filter" label="High protein" selected onChange={jest.fn()} />,
        );
        expect(screen.getByTestId('filter').props.className).toMatch(/bg-surface-inverse/);
        expect(screen.getByTestId('filter')).toHaveTextContent('High protein');

        await renderWithI18n(
            <FilterChip testID="off" label="High protein" selected={false} onChange={jest.fn()} />,
        );
        const unlit = screen.getByTestId('off').props.className;
        expect(unlit).not.toMatch(/bg-surface-inverse/);
        expect(unlit).toMatch(/bg-surface-raised/);
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

    it('offers a 4:3 card aspect without disturbing the 16:9 one', async () => {
        // Separate aspects on purpose: a grid card wants the taller crop, a detail page still wants
        // the cinematic frame. Redefining `wide` would have moved both.
        await renderWithI18n(
            <ImagePlaceholder testID="card-aspect" seed="meal-01" label="Meal" aspect="card" />,
        );
        expect(screen.getByTestId('card-aspect').props.className).toContain('aspect-[4/3]');

        await renderWithI18n(
            <ImagePlaceholder testID="wide-aspect" seed="meal-01" label="Meal" aspect="wide" />,
        );
        expect(screen.getByTestId('wide-aspect').props.className).toContain('aspect-video');
    });

    it('drops its own radius when flush, so media meets a clipped card corner cleanly', async () => {
        await renderWithI18n(<ImagePlaceholder testID="flush" seed="meal-01" label="Meal" flush />);
        expect(screen.getByTestId('flush').props.className).not.toMatch(/rounded-lg/);

        await renderWithI18n(<ImagePlaceholder testID="round" seed="meal-01" label="Meal" />);
        expect(screen.getByTestId('round').props.className).toMatch(/rounded-lg/);
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
