import { fireEvent, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { Breadcrumbs } from './breadcrumbs.tsx';
import { Pagination, paginationSlots } from './pagination.tsx';
import { Stepper } from './stepper.tsx';
import { SegmentedControl, Tabs } from './tabs.tsx';
import type { TabItem } from './tabs.tsx';

const items: readonly TabItem[] = [
    { value: 'overview', label: 'Overview', testID: 'tab-overview' },
    { value: 'nutrition', label: 'Nutrition', testID: 'tab-nutrition' },
    { value: 'delivery', label: 'Delivery', disabled: true, testID: 'tab-delivery' },
];

/**
 * Arrow-key navigation is a *web* affordance — a phone has no arrow keys — so the platform has to
 * say "web" before the handler is attached at all. Forcing it here is what lets the keyboard
 * contract be asserted from a jest-expo run whose default platform is iOS.
 */
function asWeb(): void {
    jest.replaceProperty(Platform, 'OS', 'web');
}

/** Reaches the web-only key handler the component attaches through `keyDownProps`. */
function pressKey(testID: string, key: string): void {
    const handler = screen.getByTestId(testID).props.onKeyDown as
        ((event: { key: string; preventDefault: () => void }) => void) | undefined;
    expect(handler).toBeDefined();
    handler?.({ key, preventDefault: () => undefined });
}

describe('Tabs', () => {
    it('is a named tab list of tabs', async () => {
        await renderWithI18n(
            <Tabs
                testID="tabs"
                label="Meal detail"
                items={items}
                value="overview"
                onChange={jest.fn()}
            />,
        );

        const list = screen.getByTestId('tabs');
        expect(list.props.role).toBe('tablist');
        expect(list.props['aria-label']).toBe('Meal detail');
        expect(list.props['aria-orientation']).toBe('horizontal');
        expect(screen.getByTestId('tab-overview').props.role).toBe('tab');
    });

    /**
     * Both spellings are supplied by the component; React Native folds `aria-selected` into
     * `accessibilityState` on device, and react-native-web reads the `aria-*` attribute directly on
     * the web. The merged state is therefore what a rendered native tree exposes.
     */
    it('marks exactly one tab selected', async () => {
        await renderWithI18n(
            <Tabs label="Meal detail" items={items} value="nutrition" onChange={jest.fn()} />,
        );

        expect(screen.getByTestId('tab-nutrition').props.accessibilityState).toMatchObject({
            selected: true,
        });
        expect(screen.getByTestId('tab-overview').props.accessibilityState).toMatchObject({
            selected: false,
        });
    });

    /**
     * The roving tab stop: a list of eleven diets must cost a keyboard user one Tab press, not
     * eleven. Only the selected tab is in the tab order; arrows move within the list.
     */
    it('keeps only the selected tab in the tab order', async () => {
        await renderWithI18n(
            <Tabs label="Meal detail" items={items} value="overview" onChange={jest.fn()} />,
        );

        expect(screen.getByTestId('tab-overview').props.focusable).toBe(true);
        expect(screen.getByTestId('tab-nutrition').props.focusable).toBe(false);
    });

    it('never puts a disabled tab in the tab order', async () => {
        await renderWithI18n(
            <Tabs label="Meal detail" items={items} value="delivery" onChange={jest.fn()} />,
        );

        expect(screen.getByTestId('tab-delivery').props.focusable).toBe(false);
        expect(screen.getByTestId('tab-delivery').props.accessibilityState).toMatchObject({
            disabled: true,
        });
    });

    it('selects on press', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <Tabs label="Meal detail" items={items} value="overview" onChange={onChange} />,
        );

        await fireEvent.press(screen.getByTestId('tab-nutrition'));
        expect(onChange).toHaveBeenCalledWith('nutrition');
    });

    it('moves forward with the right arrow in English, skipping disabled tabs', async () => {
        asWeb();
        const onChange = jest.fn();
        await renderWithI18n(
            <Tabs label="Meal detail" items={items} value="nutrition" onChange={onChange} />,
            'en',
        );

        pressKey('tab-nutrition', 'ArrowRight');
        // `delivery` is disabled, so forward from the last selectable tab wraps to the first.
        expect(onChange).toHaveBeenCalledWith('overview');
    });

    /**
     * The browser does not remap arrow keys for a right-to-left document, so the component does:
     * in Arabic the next tab is the one on the left.
     */
    it('moves forward with the left arrow in Arabic', async () => {
        asWeb();
        const onChange = jest.fn();
        await renderWithI18n(
            <Tabs label="تفاصيل الوجبة" items={items} value="overview" onChange={onChange} />,
            'ar',
        );

        pressKey('tab-overview', 'ArrowLeft');
        expect(onChange).toHaveBeenCalledWith('nutrition');
    });

    it('jumps to the first and last selectable tabs with Home and End', async () => {
        asWeb();
        const onChange = jest.fn();
        await renderWithI18n(
            <Tabs label="Meal detail" items={items} value="nutrition" onChange={onChange} />,
        );

        pressKey('tab-nutrition', 'End');
        expect(onChange).toHaveBeenLastCalledWith('nutrition');

        pressKey('tab-nutrition', 'Home');
        expect(onChange).toHaveBeenLastCalledWith('overview');
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Tabs
                testID="tabs"
                label="تفاصيل"
                items={items}
                value="overview"
                onChange={jest.fn()}
            />,
            'ar',
        );

        assertSubtreeIsLogical(screen.getByTestId('tabs'));
    });
});

describe('SegmentedControl', () => {
    it('is the same semantics in denser chrome', async () => {
        await renderWithI18n(
            <SegmentedControl
                testID="segments"
                label="View"
                items={items}
                value="overview"
                onChange={jest.fn()}
                block
            />,
        );

        const list = screen.getByTestId('segments');
        expect(list.props.role).toBe('tablist');
        expect(list.props.className).toContain('bg-surface-sunken');
        expect(screen.getByTestId('tab-overview').props.className).toContain('flex-1');
    });
});

describe('Stepper', () => {
    it('is a progress bar carrying its own counter as the value text', async () => {
        await renderWithI18n(
            <Stepper testID="wizard" label="Onboarding progress" current={7} total={22} />,
        );

        const node = screen.getByTestId('wizard');
        expect(node.props.role).toBe('progressbar');
        expect(node.props['aria-valuemin']).toBe(1);
        expect(node.props['aria-valuemax']).toBe(22);
        expect(node.props['aria-valuenow']).toBe(7);
        expect(node.props['aria-valuetext']).toBe('Step 7 of 22');
    });

    /** The counter is visible text, not only an ARIA value: 22 steps needs a legible position. */
    it('renders the counter as translated visible text', async () => {
        await renderWithI18n(
            <Stepper testID="wizard" label="التقدّم" current={3} total={22} />,
            'ar',
        );

        expect(screen.getByTestId('wizard-counter')).toHaveTextContent('الخطوة 3 من 22');
    });

    it('fills the bar in proportion and from the leading edge', async () => {
        await renderWithI18n(<Stepper testID="wizard" label="Progress" current={11} total={22} />);

        expect(screen.getByTestId('wizard-fill').props.style).toMatchObject({ width: '50%' });
        expect(screen.getByTestId('wizard-track').props.className).toContain('flex-row');
    });

    it('clamps a caller who asks for step zero or beyond the end', async () => {
        await renderWithI18n(<Stepper testID="low" label="Progress" current={0} total={22} />);
        expect(screen.getByTestId('low').props['aria-valuenow']).toBe(1);

        await renderWithI18n(<Stepper testID="high" label="Progress" current={99} total={22} />);
        expect(screen.getByTestId('high').props['aria-valuenow']).toBe(22);
    });

    it('shows the current step title beside the counter', async () => {
        await renderWithI18n(
            <Stepper
                testID="wizard"
                label="Progress"
                current={8}
                total={22}
                stepLabel="Activity level"
            />,
        );

        expect(screen.getByTestId('wizard-step-label')).toHaveTextContent('Activity level');
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Stepper testID="wizard" label="التقدّم" current={4} total={22} />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('wizard'));
    });
});

describe('Breadcrumbs', () => {
    const trail = [
        { key: 'home', label: 'Home', onPress: jest.fn(), testID: 'crumb-home' },
        { key: 'meals', label: 'Meals', onPress: jest.fn(), testID: 'crumb-meals' },
        { key: 'meal', label: 'Grilled halloumi bowl', testID: 'crumb-current' },
    ];

    it('is its own named navigation landmark', async () => {
        await renderWithI18n(<Breadcrumbs testID="trail" items={trail} />);

        const node = screen.getByTestId('trail');
        expect(node.props.role).toBe('navigation');
        expect(node.props['aria-label']).toBe('Breadcrumb trail');
    });

    it('marks the last crumb as the current page and does not link it', async () => {
        await renderWithI18n(<Breadcrumbs testID="trail" items={trail} />);

        expect(screen.getByTestId('crumb-current').props['aria-current']).toBe('page');
        expect(screen.getByTestId('crumb-current').props.role).toBeUndefined();
        expect(screen.getByTestId('crumb-home').props.role).toBe('link');
        expect(screen.getByTestId('crumb-home').props['aria-current']).toBeUndefined();
    });

    it('recolours every crumb for the canopy, not just its container', async () => {
        await renderWithI18n(<Breadcrumbs testID="trail" items={trail} tone="canopy" />);

        // The colours live on the items, and React Native text does not inherit colour through a
        // View — a class on the container would recolour nothing. Left on `content-secondary`, the
        // trail is 2.16:1 against the canopy, which is why this is a prop rather than a className.
        expect(screen.getByTestId('crumb-current').props.className).toContain('on-canopy-muted');
        expect(screen.getByTestId('crumb-home').props.className).not.toContain(
            'text-content-secondary',
        );
    });

    it('keeps the default tone off the canopy colours', async () => {
        await renderWithI18n(<Breadcrumbs testID="trail" items={trail} />);
        expect(screen.getByTestId('crumb-current').props.className).toContain(
            'text-content-primary',
        );
        expect(screen.getByTestId('crumb-current').props.className).not.toContain('on-canopy');
    });

    it('navigates from an ancestor crumb', async () => {
        const onPress = jest.fn();
        await renderWithI18n(
            <Breadcrumbs
                testID="trail"
                items={[
                    { key: 'home', label: 'Home', onPress, testID: 'crumb-home' },
                    { key: 'now', label: 'Now', testID: 'crumb-now' },
                ]}
            />,
        );

        await fireEvent.press(screen.getByTestId('crumb-home'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('draws no separator before the first crumb', async () => {
        await renderWithI18n(<Breadcrumbs testID="trail" items={trail} />);

        expect(screen.queryByTestId('trail-separator-0')).toBeNull();
        expect(screen.getByTestId('trail-separator-1')).toBeTruthy();
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(<Breadcrumbs testID="trail" items={trail} />, 'ar');
        assertSubtreeIsLogical(screen.getByTestId('trail'));
    });
});

describe('paginationSlots', () => {
    const shape = (page: number, total: number, siblings = 1) =>
        paginationSlots(page, total, siblings)
            .map((slot) => (slot.kind === 'gap' ? '…' : String(slot.page)))
            .join(' ');

    it('draws every page while they all fit', () => {
        expect(shape(1, 1)).toBe('1');
        expect(shape(3, 7)).toBe('1 2 3 4 5 6 7');
    });

    it('never draws a gap in place of a single page', () => {
        // The gap would stand for page 2 alone, which is longer than the page it replaced.
        expect(shape(4, 8)).toBe('1 2 3 4 5 … 8');
        expect(shape(5, 8)).toBe('1 … 4 5 6 7 8');
    });

    it('stays the same width wherever the current page is', () => {
        // A row that grows and shrinks as you page moves the buttons under the pointer: Next lands
        // on 5, then on 4, without either being pressed.
        const widths = new Set(
            Array.from({ length: 36 }, (_, index) => paginationSlots(index + 1, 36).length),
        );
        expect([...widths]).toEqual([7]);

        expect(
            new Set(Array.from({ length: 36 }, (_, i) => paginationSlots(i + 1, 36, 2).length)),
        ).toEqual(new Set([9]));
    });

    it('keeps both ends reachable from the middle of a long list', () => {
        expect(shape(18, 36)).toBe('1 … 17 18 19 … 36');
        expect(shape(1, 36)).toBe('1 2 3 4 5 … 36');
        expect(shape(36, 36)).toBe('1 … 32 33 34 35 36');
    });

    it('widens with the sibling count', () => {
        expect(shape(18, 36, 2)).toBe('1 … 16 17 18 19 20 … 36');
        expect(shape(18, 36, 0)).toBe('1 … 18 … 36');
    });

    it('clamps a page outside the range rather than rendering a hole', () => {
        // A stale deep link should land on a page, not between two.
        expect(shape(0, 8)).toBe('1 2 3 4 5 … 8');
        expect(shape(99, 8)).toBe('1 … 4 5 6 7 8');
    });

    it('has nothing to draw for an empty collection', () => {
        expect(paginationSlots(1, 0)).toEqual([]);
    });
});

describe('Pagination', () => {
    it('renders nothing when there is only one page', async () => {
        await renderWithI18n(
            <Pagination testID="pager" page={1} totalPages={1} onPageChange={jest.fn()} />,
        );
        // A row of disabled controls under a three-row list says only that the list is short.
        expect(screen.queryByTestId('pager')).toBeNull();
    });

    it('is its own named navigation landmark', async () => {
        await renderWithI18n(
            <Pagination testID="pager" page={2} totalPages={5} onPageChange={jest.fn()} />,
        );

        const node = screen.getByTestId('pager');
        expect(node.props.role).toBe('navigation');
        expect(node.props['aria-label']).toBe('Pagination');
    });

    it('announces the current page rather than relying on its weight', async () => {
        await renderWithI18n(
            <Pagination testID="pager" page={2} totalPages={5} onPageChange={jest.fn()} />,
        );

        const current = screen.getByTestId('pager-page-2');
        expect(current.props['aria-current']).toBe('page');
        expect(current.props.accessibilityLabel).toBe('Page 2');
        expect(screen.getByTestId('pager-page-3').props['aria-current']).toBeUndefined();
    });

    // React Native's Pressable folds `aria-*` into `accessibilityState`, so that is the prop worth
    // asserting — `aria-disabled` never reaches the rendered node.
    it('disables the backward step on the first page', async () => {
        await renderWithI18n(
            <Pagination testID="pager" page={1} totalPages={5} onPageChange={jest.fn()} />,
        );
        expect(screen.getByTestId('pager-previous').props.accessibilityState).toMatchObject({
            disabled: true,
        });
        expect(screen.getByTestId('pager-next').props.accessibilityState).toMatchObject({
            disabled: false,
        });
    });

    it('disables the forward step on the last page', async () => {
        await renderWithI18n(
            <Pagination testID="pager" page={5} totalPages={5} onPageChange={jest.fn()} />,
        );
        expect(screen.getByTestId('pager-previous').props.accessibilityState).toMatchObject({
            disabled: false,
        });
        expect(screen.getByTestId('pager-next').props.accessibilityState).toMatchObject({
            disabled: true,
        });
    });

    it('steps and jumps', async () => {
        const onPageChange = jest.fn();
        await renderWithI18n(
            <Pagination testID="pager" page={3} totalPages={9} onPageChange={onPageChange} />,
        );

        await fireEvent.press(screen.getByTestId('pager-next'));
        expect(onPageChange).toHaveBeenLastCalledWith(4);

        await fireEvent.press(screen.getByTestId('pager-previous'));
        expect(onPageChange).toHaveBeenLastCalledWith(2);

        await fireEvent.press(screen.getByTestId('pager-page-9'));
        expect(onPageChange).toHaveBeenLastCalledWith(9);
    });

    it('refuses every control while disabled, without collapsing the row', async () => {
        const onPageChange = jest.fn();
        await renderWithI18n(
            <Pagination
                testID="pager"
                page={3}
                totalPages={9}
                disabled
                onPageChange={onPageChange}
            />,
        );

        await fireEvent.press(screen.getByTestId('pager-next'));
        await fireEvent.press(screen.getByTestId('pager-page-1'));
        expect(onPageChange).not.toHaveBeenCalled();
        // Still mounted: a control that vanishes mid-fetch moves the list under the pointer.
        expect(screen.getByTestId('pager')).toBeTruthy();
    });

    it('uses direction-aware chevrons and logical utilities only', async () => {
        await renderWithI18n(
            <Pagination testID="pager" page={2} totalPages={5} onPageChange={jest.fn()} />,
        );
        assertSubtreeIsLogical(screen.getByTestId('pager'));
    });
});
