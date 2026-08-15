import { fireEvent, screen } from '@testing-library/react-native';

import { Icon } from '../icons/icon.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { BUTTON_SIZES, BUTTON_VARIANTS, Button, IconButton } from './button.tsx';

describe('Button', () => {
    it('is a button with its label as the accessible name', async () => {
        await renderWithI18n(<Button testID="save" label="Save" onPress={jest.fn()} />);
        const node = screen.getByTestId('save');

        expect(node.props.accessibilityRole).toBe('button');
        expect(node.props.accessibilityLabel).toBe('Save');
        expect(node.props.accessibilityState).toMatchObject({ disabled: false, busy: false });
    });

    it('fires onPress once when pressed', async () => {
        const onPress = jest.fn();
        await renderWithI18n(<Button testID="go" label="Continue" onPress={onPress} />);

        await fireEvent.press(screen.getByTestId('go'));
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it.each(BUTTON_VARIANTS)('renders the %s variant with a token background', async (variant) => {
        await renderWithI18n(
            <Button testID={`v-${variant}`} label="Label" variant={variant} onPress={jest.fn()} />,
        );
        expect(screen.getByTestId(`v-${variant}`).props.className).toMatch(/bg-|border/);
    });

    it('gives quiet a border, so a demoted control does not read as disabled', async () => {
        // Borderless was rejected during design: a bare text control in a row of filled and
        // outlined buttons looks switched off. The border says "still a button", the secondary
        // label says "not the one you came for".
        await renderWithI18n(
            <Button testID="quiet" label="Sign out" variant="quiet" onPress={jest.fn()} />,
        );
        const classes = screen.getByTestId('quiet').props.className;

        expect(classes).toContain('border-stroke-subtle');
        expect(classes).not.toContain('border-transparent');
        expect(classes).toContain('bg-surface-raised');
        expect(classes).not.toContain('opacity-50');
    });

    it('never lets quiet outrank the primary it sits beside', async () => {
        await renderWithI18n(
            <>
                <Button testID="p" label="Basket" variant="primary" onPress={jest.fn()} />
                <Button testID="q" label="Sign out" variant="quiet" onPress={jest.fn()} />
            </>,
        );
        // The whole point of the emphasis inversion: the primary carries the brand fill and the
        // quiet one carries a neutral surface. If these ever match, §8's "no screen where Sign out
        // is the highest-emphasis control" has quietly stopped being true.
        expect(screen.getByTestId('p').props.className).toContain('bg-surface-brand');
        expect(screen.getByTestId('q').props.className).not.toContain('bg-surface-brand');
    });

    it('darkens the primary on hover rather than lightening it', async () => {
        // brand-500 cannot legally carry small white text (§1.3), so the only direction available
        // from `surface-brand` is towards the canopy.
        await renderWithI18n(<Button testID="hov" label="Basket" onPress={jest.fn()} />);
        expect(screen.getByTestId('hov').props.className).toContain('hover:bg-surface-canopy');
    });

    it.each(BUTTON_SIZES)('keeps the %s size above the 44px touch minimum', async (size) => {
        await renderWithI18n(
            <Button testID={`s-${size}`} label="Label" size={size} onPress={jest.fn()} />,
        );
        expect(screen.getByTestId(`s-${size}`).props.className).toContain('min-h-touch');
    });

    describe('disabled', () => {
        it('reports itself disabled and does not fire', async () => {
            const onPress = jest.fn();
            await renderWithI18n(<Button testID="off" label="Save" disabled onPress={onPress} />);
            const node = screen.getByTestId('off');

            // React Native's Pressable folds `aria-*` into `accessibilityState`, and
            // react-native-web expands it back out again — so the state object is the honest
            // cross-platform assertion.
            expect(node.props.accessibilityState).toMatchObject({ disabled: true });
            await fireEvent.press(node);
            expect(onPress).not.toHaveBeenCalled();
        });
    });

    describe('loading', () => {
        it('announces busy, shows a spinner and refuses a second press', async () => {
            const onPress = jest.fn();
            await renderWithI18n(<Button testID="busy" label="Save" loading onPress={onPress} />);
            const node = screen.getByTestId('busy');

            expect(node.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
            expect(screen.getByTestId('busy-spinner')).toBeTruthy();

            await fireEvent.press(node);
            expect(onPress).not.toHaveBeenCalled();
        });

        it('replaces the leading icon rather than rendering both', async () => {
            await renderWithI18n(
                <Button
                    testID="busy"
                    label="Save"
                    loading
                    iconStart={<Icon testID="lead" name="check" />}
                    onPress={jest.fn()}
                />,
            );
            expect(screen.queryByTestId('lead')).toBeNull();
        });
    });

    describe('icon slots', () => {
        it('places the start slot before the label and the end slot after it in source order', async () => {
            await renderWithI18n(
                <Button
                    testID="both"
                    label="Continue"
                    iconStart={<Icon testID="start" name="chevronStart" />}
                    iconEnd={<Icon testID="end" name="chevronEnd" />}
                    onPress={jest.fn()}
                />,
            );

            // Source order inside a flex-row is what mirrors for Arabic, so it is what is asserted.
            const children = screen.getByTestId('both').children;
            const testIDs = children.map((child) =>
                typeof child === 'object' && child !== null && 'props' in child
                    ? ((child.props as { testID?: string }).testID ?? null)
                    : null,
            );

            expect(testIDs).toEqual(['start', null, 'end']);
            expect(screen.getByTestId('both')).toHaveTextContent('‹Continue›');
        });

        it('flips the trailing chevron glyph in Arabic', async () => {
            await renderWithI18n(
                <Button
                    testID="rtl"
                    label="متابعة"
                    iconEnd={<Icon testID="end" name="chevronEnd" />}
                    onPress={jest.fn()}
                />,
                'ar',
            );
            expect(screen.getByTestId('end')).toHaveTextContent('‹');
        });
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Button
                testID="logical"
                label="Save"
                iconStart={<Icon name="check" />}
                onPress={jest.fn()}
            />,
        );
        assertSubtreeIsLogical(screen.getByTestId('logical'));
    });
});

describe('IconButton', () => {
    it('requires a label and uses it as the accessible name', async () => {
        await renderWithI18n(
            <IconButton
                testID="close"
                label="Close"
                icon={<Icon name="close" />}
                onPress={jest.fn()}
            />,
        );
        const node = screen.getByTestId('close');

        expect(node.props.accessibilityRole).toBe('button');
        expect(node.props.accessibilityLabel).toBe('Close');
    });

    it.each(BUTTON_SIZES)('meets the touch target minimum at size %s', async (size) => {
        await renderWithI18n(
            <IconButton
                testID={`ib-${size}`}
                size={size}
                label="Close"
                icon={<Icon name="close" />}
                onPress={jest.fn()}
            />,
        );
        const className = screen.getByTestId(`ib-${size}`).props.className;
        expect(className).toContain('min-h-touch');
        expect(className).toContain('min-w-touch');
    });

    it('does not fire when disabled', async () => {
        const onPress = jest.fn();
        await renderWithI18n(
            <IconButton
                testID="off"
                label="Close"
                disabled
                icon={<Icon name="close" />}
                onPress={onPress}
            />,
        );
        await fireEvent.press(screen.getByTestId('off'));
        expect(onPress).not.toHaveBeenCalled();
    });
});
