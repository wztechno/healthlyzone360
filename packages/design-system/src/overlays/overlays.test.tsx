import { act, fireEvent, screen } from '@testing-library/react-native';
import { Pressable, Text as RNText } from 'react-native';

/**
 * Finds the platform dismiss callback React Native's `Modal` exposes. It is reached through the
 * rendered tree rather than by importing `Modal` and querying by type, because the dismiss contract
 * is what matters — the component that implements it is an implementation detail.
 */
function findRequestClose(node: unknown): (() => void) | null {
    if (node === null || typeof node !== 'object') return null;
    const candidate = node as {
        props?: Record<string, unknown>;
        children?: readonly unknown[] | null;
    };
    const handler = candidate.props?.['onRequestClose'];
    if (typeof handler === 'function') return handler as () => void;
    for (const child of candidate.children ?? []) {
        const found = findRequestClose(child);
        if (found !== null) return found;
    }
    return null;
}

import { Button } from '../actions/button.tsx';
import { Text } from '../primitives/text.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { ActionSheet } from './action-sheet.tsx';
import { Dialog } from './dialog.tsx';
import { DRAWER_PLACEMENTS, Drawer } from './drawer.tsx';
import { Popover } from './popover.tsx';
import { ToastProvider, useToast } from './toast.tsx';

describe('Dialog', () => {
    it('renders nothing while closed', async () => {
        await renderWithI18n(
            <Dialog testID="confirm" open={false} onClose={jest.fn()} title="Revoke this session?">
                <Text>Body</Text>
            </Dialog>,
        );
        expect(screen.queryByTestId('confirm')).toBeNull();
    });

    it('is a modal dialog with an accessible name and description', async () => {
        await renderWithI18n(
            <Dialog
                testID="confirm"
                open
                onClose={jest.fn()}
                title="Revoke this session?"
                description="The device will be signed out immediately."
            >
                <Text>Body</Text>
            </Dialog>,
        );
        const node = screen.getByTestId('confirm');

        expect(node.props.role).toBe('dialog');
        expect(node.props['aria-modal']).toBe(true);
        expect(node.props['aria-labelledby']).toBe('confirm-title');
        expect(node.props['aria-describedby']).toBe('confirm-description');
        expect(screen.getByTestId('confirm-title').props.accessibilityRole).toBe('header');
    });

    it('closes from the header control', async () => {
        const onClose = jest.fn();
        await renderWithI18n(
            <Dialog testID="confirm" open onClose={onClose} title="Revoke this session?">
                <Text>Body</Text>
            </Dialog>,
        );
        await fireEvent.press(screen.getByTestId('confirm-close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    /** react-native-web's Modal maps Escape onto `onRequestClose`; native uses the back gesture. */
    it('closes on the platform dismiss request (Escape on web, back on Android)', async () => {
        const onClose = jest.fn();
        await renderWithI18n(
            <Dialog testID="confirm" open onClose={onClose} title="Revoke this session?">
                <Text>Body</Text>
            </Dialog>,
        );

        const request = findRequestClose(screen.toJSON());
        expect(request).not.toBeNull();
        await act(async () => {
            request?.();
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on a backdrop press by default', async () => {
        const onClose = jest.fn();
        await renderWithI18n(
            <Dialog testID="confirm" open onClose={onClose} title="Revoke this session?">
                <Text>Body</Text>
            </Dialog>,
        );
        await fireEvent.press(screen.getByTestId('confirm-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('can refuse backdrop dismissal without trapping the keyboard user', async () => {
        const onClose = jest.fn();
        await renderWithI18n(
            <Dialog
                testID="confirm"
                open
                onClose={onClose}
                title="Revoke this session?"
                dismissOnBackdrop={false}
            >
                <Text>Body</Text>
            </Dialog>,
        );

        await fireEvent.press(screen.getByTestId('confirm-backdrop'));
        expect(onClose).not.toHaveBeenCalled();

        await fireEvent.press(screen.getByTestId('confirm-close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps the backdrop out of the accessibility tree', async () => {
        await renderWithI18n(
            <Dialog testID="confirm" open onClose={jest.fn()} title="Title">
                <Text>Body</Text>
            </Dialog>,
        );
        const backdrop = screen.getByTestId('confirm-backdrop');
        expect(backdrop.props['aria-hidden']).toBe(true);
        expect(backdrop.props.focusable).toBe(false);
    });

    it('renders its actions', async () => {
        await renderWithI18n(
            <Dialog
                testID="confirm"
                open
                onClose={jest.fn()}
                title="Revoke this session?"
                actions={<Button testID="go" label="Revoke" variant="danger" onPress={jest.fn()} />}
            >
                <Text>Body</Text>
            </Dialog>,
        );
        expect(screen.getByTestId('confirm-actions')).toBeTruthy();
        expect(screen.getByTestId('go')).toBeTruthy();
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Dialog testID="confirm" open onClose={jest.fn()} title="تأكيد">
                <Text>محتوى</Text>
            </Dialog>,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('confirm'));
    });
});

describe('Drawer', () => {
    it('is a labelled modal dialog', async () => {
        await renderWithI18n(
            <Drawer testID="nav" open onClose={jest.fn()} title="Main navigation">
                <Text>Links</Text>
            </Drawer>,
        );
        const node = screen.getByTestId('nav');

        expect(node.props.role).toBe('dialog');
        expect(node.props['aria-modal']).toBe(true);
        expect(node.props['aria-labelledby']).toBe('nav-title');
    });

    it('closes from the header control and from the backdrop', async () => {
        const onClose = jest.fn();
        await renderWithI18n(
            <Drawer testID="nav" open onClose={onClose} title="Main navigation">
                <Text>Links</Text>
            </Drawer>,
        );

        await fireEvent.press(screen.getByTestId('nav-close'));
        await fireEvent.press(screen.getByTestId('nav-backdrop'));
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('renders its content and footer', async () => {
        await renderWithI18n(
            <Drawer
                testID="nav"
                open
                onClose={jest.fn()}
                title="Main navigation"
                footer={<Text testID="foot">Sign out</Text>}
            >
                <Text testID="links">Links</Text>
            </Drawer>,
        );
        expect(screen.getByTestId('links')).toBeTruthy();
        expect(screen.getByTestId('foot')).toBeTruthy();
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Drawer testID="nav" open onClose={jest.fn()} title="التنقّل الرئيسي">
                <Text>روابط</Text>
            </Drawer>,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('nav'));
    });
});

function ToastHarness() {
    const { show, dismissAll, toasts } = useToast();
    return (
        <>
            <Pressable
                testID="show-success"
                onPress={() => {
                    show({ message: 'Session revoked', tone: 'success', testID: 'toast-ok' });
                }}
            >
                <RNText>show success</RNText>
            </Pressable>
            <Pressable
                testID="show-danger"
                onPress={() => {
                    show({ message: 'Could not revoke', tone: 'danger', testID: 'toast-bad' });
                }}
            >
                <RNText>show danger</RNText>
            </Pressable>
            <Pressable testID="clear" onPress={dismissAll}>
                <RNText>clear</RNText>
            </Pressable>
            <RNText testID="count">{String(toasts.length)}</RNText>
        </>
    );
}

describe('Toast', () => {
    it('renders both live regions before anything is shown', async () => {
        await renderWithI18n(
            <ToastProvider defaultDurationMs={0}>
                <ToastHarness />
            </ToastProvider>,
        );

        // Regions must pre-exist: a live region inserted with its first message is often missed.
        expect(screen.getByTestId('toast-region-polite').props['aria-live']).toBe('polite');
        expect(screen.getByTestId('toast-region-assertive').props['aria-live']).toBe('assertive');
        expect(screen.getByTestId('count')).toHaveTextContent('0');
    });

    it('shows a confirmation politely', async () => {
        await renderWithI18n(
            <ToastProvider defaultDurationMs={0}>
                <ToastHarness />
            </ToastProvider>,
        );

        await fireEvent.press(screen.getByTestId('show-success'));
        expect(screen.getByTestId('toast-ok')).toHaveTextContent(/Session revoked/);
        expect(screen.getByTestId('count')).toHaveTextContent('1');
    });

    it('shows a failure assertively', async () => {
        await renderWithI18n(
            <ToastProvider defaultDurationMs={0}>
                <ToastHarness />
            </ToastProvider>,
        );

        await fireEvent.press(screen.getByTestId('show-danger'));
        const assertive = screen.getByTestId('toast-region-assertive');
        expect(JSON.stringify(assertive.toJSON())).toContain('Could not revoke');
    });

    it('dismisses from the toast control', async () => {
        await renderWithI18n(
            <ToastProvider defaultDurationMs={0}>
                <ToastHarness />
            </ToastProvider>,
        );

        await fireEvent.press(screen.getByTestId('show-success'));
        await fireEvent.press(screen.getByTestId('toast-ok-dismiss'));
        expect(screen.queryByTestId('toast-ok')).toBeNull();
    });

    it('dismisses everything on request', async () => {
        await renderWithI18n(
            <ToastProvider defaultDurationMs={0}>
                <ToastHarness />
            </ToastProvider>,
        );

        await fireEvent.press(screen.getByTestId('show-success'));
        await fireEvent.press(screen.getByTestId('show-danger'));
        expect(screen.getByTestId('count')).toHaveTextContent('2');

        await fireEvent.press(screen.getByTestId('clear'));
        expect(screen.getByTestId('count')).toHaveTextContent('0');
    });

    it('auto-dismisses after the configured duration', async () => {
        jest.useFakeTimers();
        try {
            await renderWithI18n(
                <ToastProvider defaultDurationMs={1000}>
                    <ToastHarness />
                </ToastProvider>,
            );

            await fireEvent.press(screen.getByTestId('show-success'));
            expect(screen.getByTestId('toast-ok')).toBeTruthy();

            await act(async () => {
                jest.advanceTimersByTime(1000);
            });
            expect(screen.queryByTestId('toast-ok')).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });

    it('refuses to be used outside its provider', async () => {
        function Orphan() {
            useToast();
            return null;
        }

        // React logs the thrown render error; the assertion is on the message, not the noise.
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            await expect(renderWithI18n(<Orphan />)).rejects.toThrow(
                'useToast must be used inside a <ToastProvider>.',
            );
        } finally {
            consoleError.mockRestore();
        }
    });
});

describe('Drawer — placement', () => {
    /**
     * Placement is resolved by *source order* inside a flex row, never by an inset utility: a flex
     * row lays its children out right-to-left in Arabic on both platforms, so `start` lands on the
     * correct physical side with no mirrored geometry at all.
     */
    function orderOf(): readonly string[] {
        // The panel sits inside a single-child motion wrapper (SlideIn), so climb from the
        // panel to the first ancestor holding the row/column, then resolve each child's
        // identity through any wrapper to its first labelled descendant.
        type Node = { props?: Record<string, unknown>; children?: readonly unknown[] };
        let container = screen.getByTestId('nav').parent as Node | null;
        while (container && (container.children ?? []).length < 2) {
            container = (container as { parent?: Node | null }).parent ?? null;
        }
        const firstTestId = (node: Node): string => {
            const own = String(node.props?.['testID'] ?? '');
            if (own.length > 0) return own;
            for (const child of (node.children ?? []) as readonly Node[]) {
                if (typeof child === 'object' && child !== null) {
                    const found = firstTestId(child);
                    if (found.length > 0) return found;
                }
            }
            return '';
        };
        return ((container?.children ?? []) as readonly Node[])
            .filter((child) => typeof child === 'object' && child !== null)
            .map((child) => firstTestId(child))
            .filter((id) => id.length > 0);
    }

    it('defaults to the leading edge, panel first', async () => {
        await renderWithI18n(
            <Drawer testID="nav" open onClose={jest.fn()} title="Filters">
                <Text>Body</Text>
            </Drawer>,
        );

        expect(orderOf()).toEqual(['nav', 'nav-backdrop']);
    });

    it('puts the panel last for the trailing edge', async () => {
        await renderWithI18n(
            <Drawer testID="nav" open onClose={jest.fn()} title="Filters" placement="end">
                <Text>Body</Text>
            </Drawer>,
        );

        expect(orderOf()).toEqual(['nav-backdrop', 'nav']);
    });

    it('becomes a bottom sheet in a column, backdrop above', async () => {
        await renderWithI18n(
            <Drawer testID="nav" open onClose={jest.fn()} title="Filters" placement="bottom">
                <Text>Body</Text>
            </Drawer>,
        );

        expect(orderOf()).toEqual(['nav-backdrop', 'nav']);
        expect(screen.getByTestId('nav').props.className).toContain('rounded-t-2xl');
        expect(screen.getByTestId('nav').props.className).not.toContain('h-full');
    });

    it.each(DRAWER_PLACEMENTS)(
        'uses no physical direction utility for placement=%s',
        async (placement) => {
            await renderWithI18n(
                <Drawer
                    testID="nav"
                    open
                    onClose={jest.fn()}
                    title="المرشّحات"
                    placement={placement}
                >
                    <Text>محتوى</Text>
                </Drawer>,
                'ar',
            );
            assertSubtreeIsLogical(screen.getByTestId('nav'));
        },
    );
});

describe('ActionSheet', () => {
    const actions = [
        { key: 'duplicate', label: 'Duplicate', onPress: jest.fn() },
        { key: 'share', label: 'Share', onPress: jest.fn() },
        {
            key: 'delete',
            label: 'Delete',
            tone: 'destructive' as const,
            onPress: jest.fn(),
        },
    ];

    it('is a bottom drawer holding a menu', async () => {
        await renderWithI18n(
            <ActionSheet
                testID="sheet"
                open
                onClose={jest.fn()}
                title="Choose an action"
                actions={actions}
            />,
        );

        expect(screen.getByTestId('sheet').props.role).toBe('dialog');
        expect(screen.getByTestId('sheet').props.className).toContain('rounded-t-2xl');
        expect(screen.getByTestId('sheet-actions').props.role).toBe('menu');
        expect(screen.getByTestId('sheet-action-share').props.accessibilityRole).toBe('menuitem');
    });

    /** A sheet still standing over the screen it just changed hides the result. */
    it('closes before it runs the action', async () => {
        const order: string[] = [];
        await renderWithI18n(
            <ActionSheet
                testID="sheet"
                open
                onClose={() => order.push('close')}
                title="Choose an action"
                actions={[{ key: 'go', label: 'Go', onPress: () => order.push('action') }]}
            />,
        );

        await fireEvent.press(screen.getByTestId('sheet-action-go'));
        expect(order).toEqual(['close', 'action']);
    });

    /** A destructive action must still be distinguishable in greyscale. */
    it('marks a destructive action with an icon as well as a tone', async () => {
        await renderWithI18n(
            <ActionSheet
                testID="sheet"
                open
                onClose={jest.fn()}
                title="Choose an action"
                actions={actions}
            />,
        );

        const icon = screen.getByTestId('sheet-action-delete-icon');
        expect(icon.props.className).toContain('text-danger-strong');
        expect(screen.queryByTestId('sheet-action-share-icon')).toBeNull();
    });

    it('does not run a disabled action', async () => {
        const onPress = jest.fn();
        await renderWithI18n(
            <ActionSheet
                testID="sheet"
                open
                onClose={jest.fn()}
                title="Choose an action"
                actions={[{ key: 'go', label: 'Go', disabled: true, onPress }]}
            />,
        );

        await fireEvent.press(screen.getByTestId('sheet-action-go'));
        expect(onPress).not.toHaveBeenCalled();
    });

    it('offers a translated cancel that only closes', async () => {
        const onClose = jest.fn();
        await renderWithI18n(
            <ActionSheet
                testID="sheet"
                open
                onClose={onClose}
                title="اختر إجراءً"
                actions={actions}
            />,
            'ar',
        );

        await fireEvent.press(screen.getByTestId('sheet-cancel'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <ActionSheet
                testID="sheet"
                open
                onClose={jest.fn()}
                title="اختر إجراءً"
                actions={actions}
            />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('sheet'));
    });
});

describe('Popover', () => {
    it('is a collapsed trigger that owns a panel', async () => {
        await renderWithI18n(
            <Popover testID="why" triggerLabel="Why this figure?" title="How this is worked out">
                <Text>Body</Text>
            </Popover>,
        );

        const trigger = screen.getByTestId('why-trigger');
        expect(trigger.props.accessibilityRole).toBe('button');
        expect(trigger.props.accessibilityState).toMatchObject({ expanded: false });
        expect(trigger.props['aria-controls']).toBe('why-panel');
        expect(screen.queryByTestId('why-panel')).toBeNull();
    });

    it('opens and closes on press', async () => {
        await renderWithI18n(
            <Popover testID="why" triggerLabel="Why this figure?" title="How this is worked out">
                <Text testID="explanation">Body</Text>
            </Popover>,
        );

        await fireEvent.press(screen.getByTestId('why-trigger'));
        expect(screen.getByTestId('why-panel').props.role).toBe('dialog');
        expect(screen.getByTestId('explanation')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('why-trigger'));
        expect(screen.queryByTestId('why-panel')).toBeNull();
    });

    /**
     * A touch screen has no hover state, so a hover-only affordance would be unreachable there
     * (07-animation-and-motion-inventory.md, CST-03). On a coarse pointer — which is every native
     * target — the component degrades to press, and the *behaviour* is what this asserts: the
     * explanation is still reachable. Which pointer the device has is `usePointerKind`'s job and is
     * tested there.
     */
    it('is still reachable by press when asked to trigger on hover', async () => {
        await renderWithI18n(
            <Popover
                testID="why"
                trigger="hover"
                triggerLabel="Why this figure?"
                title="How this is worked out"
            >
                <Text testID="explanation">Body</Text>
            </Popover>,
        );

        await fireEvent.press(screen.getByTestId('why-trigger'));
        expect(screen.getByTestId('explanation')).toBeTruthy();
    });

    it('anchors the panel with no horizontal inset at all', async () => {
        await renderWithI18n(
            <Popover testID="why" triggerLabel="Why?" title="Explanation">
                <Text>Body</Text>
            </Popover>,
        );

        await fireEvent.press(screen.getByTestId('why-trigger'));
        const panel = screen.getByTestId('why-panel');
        expect(panel.props.className).toContain('top-full');
        expect(panel.props.className).not.toMatch(/\b(start|end)-\d/);
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Popover testID="why" triggerLabel="لماذا؟" title="التفسير">
                <Text>نص</Text>
            </Popover>,
            'ar',
        );

        await fireEvent.press(screen.getByTestId('why-trigger'));
        assertSubtreeIsLogical(screen.getByTestId('why'));
    });
});
