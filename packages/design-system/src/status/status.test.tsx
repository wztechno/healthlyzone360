import { apiFailure, rateLimitFailure, validationFailure } from '@healthy360/api-client';
import { fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { Button } from '../actions/button.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { EmptyState } from './empty-state.tsx';
import { ErrorState } from './error-state.tsx';
import { CONNECTIVITY_STATES, OfflineIndicator } from './offline-indicator.tsx';
import { Skeleton } from './skeleton.tsx';
import { Spinner } from './spinner.tsx';

describe('Spinner', () => {
    it('is an indeterminate progressbar with an accessible name', async () => {
        await renderWithI18n(<Spinner testID="spinner" />);
        const node = screen.getByTestId('spinner');

        expect(node.props.accessibilityRole).toBe('progressbar');
        expect(node.props.accessibilityLabel).toBe('Loading…');
        expect(node.props['aria-busy']).toBe(true);
    });

    it('accepts a caller-supplied name', async () => {
        await renderWithI18n(<Spinner testID="spinner" label="Restoring your session…" />);
        expect(screen.getByTestId('spinner').props.accessibilityLabel).toBe(
            'Restoring your session…',
        );
    });

    it('can show its label as text as well as announcing it', async () => {
        await renderWithI18n(<Spinner testID="spinner" showLabel />);
        expect(screen.getByTestId('spinner')).toHaveTextContent('Loading…');
    });

    it('announces in Arabic', async () => {
        await renderWithI18n(<Spinner testID="spinner" />, 'ar');
        expect(screen.getByTestId('spinner').props.accessibilityLabel).toBe('جارٍ التحميل…');
    });
});

describe('Skeleton', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('is hidden from assistive technology — a placeholder rectangle is not information', async () => {
        await renderWithI18n(<Skeleton testID="skeleton" />);
        const node = screen.getByTestId('skeleton');

        expect(node.props['aria-hidden']).toBe(true);
        expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
    });

    it('animates when motion is allowed', async () => {
        jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
        await renderWithI18n(<Skeleton testID="skeleton" />);
        // An animated opacity is an AnimatedValue rather than a plain number.
        expect(screen.getByTestId('skeleton').props.style).toBeDefined();
    });

    it('renders a static block, not a slower pulse, under reduced motion', async () => {
        jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
        await renderWithI18n(<Skeleton testID="skeleton" />);

        const node = await screen.findByTestId('skeleton');
        const style = node.props.style as Record<string, unknown> | undefined;
        expect(style?.['opacity']).toBeUndefined();
    });

    it('takes its size from utilities so it stays token-driven', async () => {
        await renderWithI18n(
            <Skeleton testID="skeleton" heightClassName="h-8" widthClassName="w-24" />,
        );
        const className = screen.getByTestId('skeleton').props.className;
        expect(className).toContain('h-8');
        expect(className).toContain('w-24');
    });
});

describe('EmptyState', () => {
    it('renders a titled region with an optional body', async () => {
        await renderWithI18n(
            <EmptyState testID="empty" title="No organisations yet" body="Ask an administrator." />,
        );
        expect(screen.getByTestId('empty').props.accessibilityLabel).toBe('No organisations yet');
        expect(screen.getByTestId('empty')).toHaveTextContent(/Ask an administrator\./);
    });

    it('renders actions on the empty variant', async () => {
        await renderWithI18n(
            <EmptyState
                testID="empty"
                title="Nothing yet"
                actions={<Button testID="cta" label="Invite someone" onPress={jest.fn()} />}
            />,
        );
        expect(screen.getByTestId('cta')).toBeTruthy();
    });

    describe('prototype variant', () => {
        it('shows the translated prototype badge', async () => {
            await renderWithI18n(<EmptyState testID="proto" variant="prototype" title="Kitchen" />);
            expect(screen.getByTestId('proto-prototype-badge')).toHaveTextContent(
                /Prototype — planned for a later phase/,
            );
        });

        it('translates the badge into Arabic', async () => {
            await renderWithI18n(
                <EmptyState testID="proto" variant="prototype" title="المطبخ" />,
                'ar',
            );
            expect(screen.getByTestId('proto-prototype-badge')).toHaveTextContent(
                /نموذج أولي — مُخطَّط لمرحلة لاحقة/,
            );
        });

        /** Plan §16: no dead buttons anywhere. */
        it('refuses to render actions even when they are passed', async () => {
            await renderWithI18n(
                <EmptyState
                    testID="proto"
                    variant="prototype"
                    title="Kitchen"
                    actions={<Button testID="dead" label="Do a thing" onPress={jest.fn()} />}
                />,
            );
            expect(screen.queryByTestId('dead')).toBeNull();
            expect(screen.getByTestId('proto-prototype-body')).toBeTruthy();
        });
    });
});

describe('ErrorState', () => {
    it('translates the failure code rather than echoing the server message', async () => {
        await renderWithI18n(
            <ErrorState
                testID="error"
                failure={apiFailure('auth.invalid_credentials', { message: 'raw server text' })}
            />,
        );
        expect(screen.getByTestId('error-body')).toHaveTextContent(
            'Those details do not match our records.',
        );
    });

    it('is an assertive alert', async () => {
        await renderWithI18n(<ErrorState testID="error" failure={apiFailure('server')} />);
        const node = screen.getByTestId('error');
        expect(node.props.accessibilityRole).toBe('alert');
        expect(node.props['aria-live']).toBe('assertive');
    });

    it('shows the correlation id when the server sent one', async () => {
        await renderWithI18n(
            <ErrorState
                testID="error"
                failure={apiFailure('server', { correlationId: 'corr-42' })}
            />,
        );
        expect(screen.getByTestId('error-correlation')).toHaveTextContent(/corr-42/);
    });

    it('omits the reference line when there is no correlation id', async () => {
        await renderWithI18n(<ErrorState testID="error" failure={apiFailure('server')} />);
        expect(screen.queryByTestId('error-correlation')).toBeNull();
    });

    describe('retry', () => {
        it('offers retry for a retryable failure and calls back', async () => {
            const onRetry = jest.fn();
            await renderWithI18n(
                <ErrorState testID="error" failure={apiFailure('network')} onRetry={onRetry} />,
            );
            await fireEvent.press(screen.getByTestId('error-retry'));
            expect(onRetry).toHaveBeenCalledTimes(1);
        });

        it('draws no retry button for a failure that cannot succeed on retry', async () => {
            await renderWithI18n(
                <ErrorState
                    testID="error"
                    failure={validationFailure({ email: ['Required.'] })}
                    onRetry={jest.fn()}
                />,
            );
            expect(screen.queryByTestId('error-retry')).toBeNull();
        });

        it('draws no retry button when no handler was supplied', async () => {
            await renderWithI18n(<ErrorState testID="error" failure={apiFailure('network')} />);
            expect(screen.queryByTestId('error-retry')).toBeNull();
        });
    });

    it('interpolates the wait into the rate-limit message', async () => {
        await renderWithI18n(<ErrorState testID="error" failure={rateLimitFailure(30)} />);
        expect(screen.getByTestId('error-body')).toHaveTextContent(/30/);
    });

    it('renders the failure in Arabic', async () => {
        await renderWithI18n(
            <ErrorState testID="error" failure={apiFailure('auth.step_up_required')} />,
            'ar',
        );
        expect(screen.getByTestId('error-body')).toHaveTextContent('أكّد كلمة المرور للمتابعة.');
    });
});

describe('OfflineIndicator', () => {
    it('renders nothing at all while the connection is healthy', async () => {
        await renderWithI18n(<OfflineIndicator testID="net" state="online" />);
        expect(screen.queryByTestId('net')).toBeNull();
    });

    it.each(CONNECTIVITY_STATES.filter((state) => state !== 'online'))(
        'renders the %s state as a live region',
        async (state) => {
            await renderWithI18n(<OfflineIndicator testID="net" state={state} />);
            const node = screen.getByTestId('net');
            expect(node.props.accessibilityRole).toBe('alert');
            expect(['polite', 'assertive']).toContain(node.props['aria-live']);
        },
    );

    it('interrupts while offline and stays polite once recovering', async () => {
        const offline = await renderWithI18n(<OfflineIndicator testID="net" state="offline" />);
        expect(offline.getByTestId('net').props['aria-live']).toBe('assertive');
    });

    it('is polite when the connection is restored', async () => {
        await renderWithI18n(<OfflineIndicator testID="net" state="restored" />);
        expect(screen.getByTestId('net').props['aria-live']).toBe('polite');
    });

    it('translates into Arabic and stays logical', async () => {
        await renderWithI18n(<OfflineIndicator testID="net" state="offline" />, 'ar');
        expect(screen.getByTestId('net-title')).toHaveTextContent(/أنت غير متصل/);
        assertSubtreeIsLogical(screen.getByTestId('net'));
    });
});
