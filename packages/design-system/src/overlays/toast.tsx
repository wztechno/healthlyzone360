import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export const TOAST_TONES = ['neutral', 'success', 'warning', 'danger', 'info'] as const;
export type ToastTone = (typeof TOAST_TONES)[number];

const TONE_CLASS: Readonly<Record<ToastTone, string>> = {
    neutral: 'bg-surface-inverse border-transparent',
    success: 'bg-success-subtle border-success-border',
    warning: 'bg-warning-subtle border-warning-border',
    danger: 'bg-danger-subtle border-danger-border',
    info: 'bg-info-subtle border-info-border',
};

const TONE_TEXT_CLASS: Readonly<Record<ToastTone, string>> = {
    neutral: 'text-content-inverse',
    success: 'text-success-on-subtle',
    warning: 'text-warning-on-subtle',
    danger: 'text-danger-on-subtle',
    info: 'text-info-on-subtle',
};

const TONE_ICON: Readonly<Record<ToastTone, IconName>> = {
    neutral: 'info',
    success: 'success',
    warning: 'warning',
    danger: 'error',
    info: 'info',
};

/** Failures interrupt; confirmations do not. */
const TONE_POLITENESS: Readonly<Record<ToastTone, 'polite' | 'assertive'>> = {
    neutral: 'polite',
    success: 'polite',
    warning: 'assertive',
    danger: 'assertive',
    info: 'polite',
};

export interface ToastOptions {
    readonly message: string;
    readonly tone?: ToastTone | undefined;
    /** Milliseconds before the toast dismisses itself. `0` keeps it until dismissed. */
    readonly durationMs?: number | undefined;
    readonly testID?: string | undefined;
}

export interface Toast extends ToastOptions {
    readonly id: string;
}

export interface ToastApi {
    readonly show: (options: ToastOptions) => string;
    readonly dismiss: (id: string) => void;
    readonly dismissAll: () => void;
    readonly toasts: readonly Toast[];
}

const ToastContext = createContext<ToastApi | null>(null);

export const DEFAULT_TOAST_DURATION_MS = 5000;

export interface ToastProviderProps {
    readonly children: ReactNode;
    /** Set to `0` in tests so a pending timer cannot outlive the assertion. */
    readonly defaultDurationMs?: number | undefined;
}

/**
 * Toast provider.
 *
 * The live region is rendered **once, always**, even with nothing in it. An `aria-live` container
 * that is inserted at the moment it gains content is frequently missed by screen readers, which
 * only observe regions that existed when they built their model of the page.
 */
export function ToastProvider({ children, defaultDurationMs }: ToastProviderProps) {
    const { t } = useTranslation();
    const [toasts, setToasts] = useState<readonly Toast[]>([]);
    const counter = useRef(0);
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

    const dismiss = useCallback((id: string) => {
        const timer = timers.current.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
        setToasts((current) => current.filter((toast) => toast.id !== id));
    }, []);

    const show = useCallback(
        (options: ToastOptions) => {
            counter.current += 1;
            const id = `toast-${counter.current}`;
            setToasts((current) => [...current, { ...options, id }]);

            const duration = options.durationMs ?? defaultDurationMs ?? DEFAULT_TOAST_DURATION_MS;
            if (duration > 0) {
                timers.current.set(
                    id,
                    setTimeout(() => {
                        dismiss(id);
                    }, duration),
                );
            }
            return id;
        },
        [defaultDurationMs, dismiss],
    );

    const dismissAll = useCallback(() => {
        for (const timer of timers.current.values()) clearTimeout(timer);
        timers.current.clear();
        setToasts([]);
    }, []);

    const timersRef = timers;
    useEffect(
        () => () => {
            for (const timer of timersRef.current.values()) clearTimeout(timer);
            timersRef.current.clear();
        },
        [timersRef],
    );

    const api = useMemo<ToastApi>(
        () => ({ show, dismiss, dismissAll, toasts }),
        [show, dismiss, dismissAll, toasts],
    );

    return (
        <ToastContext.Provider value={api}>
            {children}

            <View
                testID="toast-region-polite"
                role="status"
                aria-live="polite"
                accessibilityLiveRegion="polite"
                className="absolute bottom-4 end-4 start-4 flex-col gap-2"
                pointerEvents="box-none"
            >
                {toasts
                    .filter((toast) => TONE_POLITENESS[toast.tone ?? 'neutral'] === 'polite')
                    .map((toast) => (
                        <ToastItem
                            key={toast.id}
                            toast={toast}
                            closeLabel={t('common:action.close')}
                            onDismiss={dismiss}
                        />
                    ))}
            </View>

            <View
                testID="toast-region-assertive"
                role="alert"
                aria-live="assertive"
                accessibilityLiveRegion="assertive"
                className="absolute bottom-4 end-4 start-4 flex-col gap-2"
                pointerEvents="box-none"
            >
                {toasts
                    .filter((toast) => TONE_POLITENESS[toast.tone ?? 'neutral'] === 'assertive')
                    .map((toast) => (
                        <ToastItem
                            key={toast.id}
                            toast={toast}
                            closeLabel={t('common:action.close')}
                            onDismiss={dismiss}
                        />
                    ))}
            </View>
        </ToastContext.Provider>
    );
}

function ToastItem({
    toast,
    closeLabel,
    onDismiss,
}: {
    readonly toast: Toast;
    readonly closeLabel: string;
    readonly onDismiss: (id: string) => void;
}) {
    const tone = toast.tone ?? 'neutral';
    return (
        <View
            testID={toast.testID ?? `toast-${tone}`}
            className={cx(
                'flex-row items-center gap-2 rounded-lg border px-4 py-3 shadow-elevation-3',
                TONE_CLASS[tone],
            )}
        >
            <Icon name={TONE_ICON[tone]} size="sm" className={TONE_TEXT_CLASS[tone]} />
            <RNText className={cx('flex-1 text-sm text-start', TONE_TEXT_CLASS[tone])}>
                {toast.message}
            </RNText>
            <IconButton
                testID={`${toast.testID ?? `toast-${tone}`}-dismiss`}
                size="sm"
                label={closeLabel}
                icon={<Icon name="close" className={TONE_TEXT_CLASS[tone]} />}
                onPress={() => {
                    onDismiss(toast.id);
                }}
            />
        </View>
    );
}

export function useToast(): ToastApi {
    const api = useContext(ToastContext);
    if (api === null) {
        throw new Error('useToast must be used inside a <ToastProvider>.');
    }
    return api;
}
