import { fireEvent, screen } from '@testing-library/react-native';
import { Platform, Pressable, Text as RNText } from 'react-native';

import { Dropdown } from './dropdown.tsx';
import { Menu } from './menu.tsx';
import { ConfirmationDialog } from './confirmation-dialog.tsx';
import { renderWithI18n } from '../testing/render.tsx';

/**
 * The two §4.3 bugs, and the behaviour that follows from owning them centrally.
 *
 * Both cost real debugging time in the mock, and both are invisible in a screenshot — a menu that
 * looks perfect and whose items cannot be pressed, and a scrollbar 44px wider than anything on
 * screen explains. So they are asserted here, at the component that owns them, rather than left to
 * be rediscovered at each call site.
 */

function TriggerMenu({ onSelect = () => undefined }: { readonly onSelect?: () => void }) {
    return (
        <Menu
            testID="row-menu"
            label="Row actions"
            trigger={(state) => (
                <Pressable testID="row-menu-trigger" {...state.triggerProps} onPress={state.toggle}>
                    <RNText>⋯</RNText>
                </Pressable>
            )}
            sections={[
                {
                    items: [
                        { key: 'view', label: 'View', icon: 'eye', onSelect },
                        // `eye` and not `pen`: `pen` and `archive` are the two glyphs §10 records
                        // as missing from `ICON_GLYPHS`, and this pass does not invent them.
                        { key: 'edit', label: 'Edit', icon: 'eye', onSelect },
                    ],
                },
            ]}
        />
    );
}

describe('Dropdown', () => {
    it('does not render its panel until it is opened', async () => {
        await renderWithI18n(
            <Dropdown
                testID="drop"
                label="Filter"
                trigger={(state) => (
                    <Pressable testID="drop-trigger" {...state.triggerProps} onPress={state.toggle}>
                        <RNText>Status</RNText>
                    </Pressable>
                )}
            >
                <RNText testID="panel-content">Draft</RNText>
            </Dropdown>,
        );

        // A closed panel is absent from the tree, not hidden in it. A hidden one leaves every item
        // in the accessibility tree and reachable by tab, which is the failure `app-shell.tsx`
        // documents for its off-screen navigation.
        expect(screen.queryByTestId('panel-content')).toBeNull();

        await fireEvent.press(screen.getByTestId('drop-trigger'));
        expect(screen.getByTestId('panel-content')).toBeTruthy();
    });

    it('hands the trigger the expanded state and the panel it controls', async () => {
        await renderWithI18n(
            <Dropdown
                testID="drop"
                label="Filter"
                trigger={(state) => (
                    <Pressable testID="drop-trigger" {...state.triggerProps} onPress={state.toggle}>
                        <RNText>Status</RNText>
                    </Pressable>
                )}
            >
                <RNText>Draft</RNText>
            </Dropdown>,
        );

        // `accessibilityState`, not `aria-expanded`. Under jest-expo's native preset `Pressable`
        // forwards React Native's own accessibility props and drops the `aria-*` spellings, which
        // react-native-web maps for the DOM. Asserting the ARIA attribute here would be asserting
        // on the web renderer while running the native one — so the assertion follows the platform
        // under test, and `Dropdown` supplies both.
        const trigger = screen.getByTestId('drop-trigger');
        expect(trigger.props.accessibilityState.expanded).toBe(false);

        await fireEvent.press(trigger);
        expect(screen.getByTestId('drop-trigger').props.accessibilityState.expanded).toBe(true);
        // The panel the trigger names in `aria-controls` is the one that appeared.
        expect(screen.getByTestId('drop-panel').props.nativeID).toBe('drop-panel');
    });

    it('carries no pointer handler on native, where there is no document to close it', async () => {
        await renderWithI18n(<TriggerMenu />);
        await fireEvent.press(screen.getByTestId('row-menu-trigger'));

        // The swallow exists to stop a *web* document listener. Native has neither the listener nor
        // the event, so the handler must be genuinely absent rather than a no-op that looks like
        // one — the same bargain `keyDownProps` strikes.
        expect(screen.getByTestId('row-menu-panel').props.onPointerDown).toBeUndefined();
    });
});

describe('Dropdown on the web', () => {
    // `Platform.OS` is read at render time by `usePointerSwallow`, and the swallow is the whole
    // reason `Dropdown` exists rather than each call site composing a popover with a list. Testing
    // it on the platform it applies to means standing the platform up, because jest-expo runs the
    // native preset here.
    const original = Platform.OS;

    beforeAll(() => {
        Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    });

    afterAll(() => {
        Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    });

    it('swallows pointerdown on the panel so its items stay pressable', async () => {
        await renderWithI18n(<TriggerMenu />);
        await fireEvent.press(screen.getByTestId('row-menu-trigger'));

        // The bug this prevents: the document-level outside-press closer fires on `pointerdown`
        // and unmounts the panel before the item under the cursor receives its `click`, so the
        // action becomes unreachable. It must be `stopPropagation` and not `preventDefault` — the
        // press still has to reach the item, it just must not reach the document.
        const panel = screen.getByTestId('row-menu-panel');
        expect(typeof panel.props.onPointerDown).toBe('function');

        let reachedDocument = true;
        panel.props.onPointerDown({
            stopPropagation: () => {
                reachedDocument = false;
            },
        });
        expect(reachedDocument).toBe(false);
    });
});

describe('Menu', () => {
    it('invokes a command and closes', async () => {
        const onSelect = jest.fn();
        await renderWithI18n(<TriggerMenu onSelect={onSelect} />);

        await fireEvent.press(screen.getByTestId('row-menu-trigger'));
        await fireEvent.press(screen.getByTestId('row-menu-item-view'));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('row-menu-item-view')).toBeNull();
    });

    it('keeps a toggleable filter value open so several can be picked in a row', async () => {
        const onSelect = jest.fn();
        await renderWithI18n(
            <Menu
                testID="filter"
                label="Category"
                trigger={(state) => (
                    <Pressable testID="filter-trigger" {...state.triggerProps} onPress={state.toggle}>
                        <RNText>Category</RNText>
                    </Pressable>
                )}
                sections={[
                    {
                        items: [
                            { key: 'dairy', label: 'Dairy', selected: false, onSelect },
                            { key: 'grain', label: 'Grain', selected: true, onSelect },
                        ],
                    },
                ]}
            />,
        );

        await fireEvent.press(screen.getByTestId('filter-trigger'));
        await fireEvent.press(screen.getByTestId('filter-item-dairy'));

        expect(onSelect).toHaveBeenCalledTimes(1);
        // Still open: narrowing a column by three values is three presses, not three round trips
        // through the trigger.
        expect(screen.getByTestId('filter-item-grain')).toBeTruthy();
    });

    it('reports a toggleable item as checked and a command as neither', async () => {
        await renderWithI18n(
            <Menu
                testID="filter"
                label="Category"
                trigger={(state) => (
                    <Pressable testID="filter-trigger" {...state.triggerProps} onPress={state.toggle}>
                        <RNText>Category</RNText>
                    </Pressable>
                )}
                sections={[
                    {
                        items: [
                            { key: 'grain', label: 'Grain', selected: true, onSelect: () => undefined },
                            { key: 'clear', label: 'Clear', onSelect: () => undefined },
                        ],
                    },
                ]}
            />,
        );

        await fireEvent.press(screen.getByTestId('filter-trigger'));

        expect(screen.getByTestId('filter-item-grain').props.accessibilityState.checked).toBe(true);
        // A command that reported `checked: false` would tell a screen reader user the action has
        // been turned off rather than that it is available. `selected: undefined` is what keeps the
        // two shapes distinct, and this is where that distinction is observable.
        expect(
            screen.getByTestId('filter-item-clear').props.accessibilityState.checked,
        ).toBeUndefined();
    });

    it('does not fire a disabled item', async () => {
        const onSelect = jest.fn();
        await renderWithI18n(
            <Menu
                testID="row"
                label="Row actions"
                trigger={(state) => (
                    <Pressable testID="row-trigger" {...state.triggerProps} onPress={state.toggle}>
                        <RNText>⋯</RNText>
                    </Pressable>
                )}
                sections={[{ items: [{ key: 'archive', label: 'Archive', disabled: true, onSelect }] }]}
            />,
        );

        await fireEvent.press(screen.getByTestId('row-trigger'));
        await fireEvent.press(screen.getByTestId('row-item-archive'));
        expect(onSelect).not.toHaveBeenCalled();
    });
});

describe('ConfirmationDialog', () => {
    it('puts the confirming action last and names its verb', async () => {
        const onConfirm = jest.fn();
        const onCancel = jest.fn();
        await renderWithI18n(
            <ConfirmationDialog
                testID="confirm"
                open
                onCancel={onCancel}
                onConfirm={onConfirm}
                title="Archive Tahini paste?"
                confirmLabel="Archive ingredient"
                destructive
            />,
        );

        await fireEvent.press(screen.getByTestId('confirm-confirm'));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onCancel).not.toHaveBeenCalled();
    });

    it('falls back to the translated generic confirm label', async () => {
        await renderWithI18n(
            <ConfirmationDialog
                testID="confirm"
                open
                onCancel={() => undefined}
                onConfirm={() => undefined}
                title="Discard changes?"
            />,
        );

        expect(screen.getByTestId('confirm-confirm')).toHaveTextContent('Confirm');
        expect(screen.getByTestId('confirm-cancel')).toHaveTextContent('Cancel');
    });
});
