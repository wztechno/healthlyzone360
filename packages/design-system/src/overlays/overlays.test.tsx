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
import { Dialog } from './dialog.tsx';
import { Drawer } from './drawer.tsx';
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
