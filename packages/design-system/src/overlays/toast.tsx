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
import { Animated, Easing, Image, Platform, Pressable, Text as RNText, View } from 'react-native';
import type { ImageSourcePropType } from 'react-native';

import { Button, IconButton } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { useMotion } from '../motion/use-motion.ts';

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
    /**
     * One follow-up the confirmation leads to — "View cart" after an add. Pressing it also
     * dismisses the toast: the person has acted on it, so it has nothing left to say.
     */
    readonly action?: ToastAction | undefined;
    /**
     * A bold first line. With it, `message` becomes the quieter line under it — "Chicken Tawouk
     * added" over "Your basket: 3 items". The default look reads the two as one sentence.
     */
    readonly title?: string | undefined;
    /**
     * Something the person can take back — "Basmati rice archived · Undo". On the `desk` look it
     * is drawn in dark ink with a line running out under it, and is the only toast that is.
     */
    readonly undo?: boolean | undefined;
    /** A photograph in place of the tone's icon — the dish just added. `card` look only. */
    readonly image?: ImageSourcePropType | undefined;
    /**
     * `card` is the web shop's toast: a dark rounded card centred at the foot of the page, the
     * tone's colour in its icon disc and in a bar that runs down as it times out. The shop's shells
     * set it for everything under them with {@link ToastLookScope}, so a call site never names it;
     * everywhere else keeps `default`.
     */
    readonly look?: ToastLook | undefined;
}

export type ToastLook = 'default' | 'card' | 'desk';

export interface ToastAction {
    readonly label: string;
    readonly onPress: () => void;
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
/** Lifts the toasts above a bar pinned to the foot of the page — the desk's save bar. */
const ToastInsetContext = createContext<((owner: object, inset: number) => void) | null>(null);

/**
 * Keeps the toasts clear of something pinned to the bottom of the page: while this is mounted with
 * a non-zero `inset`, the toast column rises by that many pixels. Several owners may ask at once;
 * the highest wins. Outside a provider it does nothing.
 */
export function useToastInset(inset: number): void {
    const setInset = useContext(ToastInsetContext);
    const [owner] = useState(() => ({}));
    useEffect(() => {
        if (setInset === null) return undefined;
        setInset(owner, inset);
        return () => {
            setInset(owner, 0);
        };
    }, [inset, owner, setInset]);
}
const ToastLookContext = createContext<ToastLook>('default');

/**
 * Sets the look of every toast shown from under it. The web shop's shells wrap their pages in
 * `<ToastLookScope look="card">`; the kitchen admin's layout sets `desk`.
 */
export function ToastLookScope({
    look,
    children,
}: {
    readonly look: ToastLook;
    readonly children: ReactNode;
}) {
    return <ToastLookContext.Provider value={look}>{children}</ToastLookContext.Provider>;
}

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
    const [insets, setInsets] = useState<ReadonlyMap<object, number>>(() => new Map());
    const setInset = useCallback((owner: object, inset: number) => {
        setInsets((current) => {
            if ((current.get(owner) ?? 0) === inset) return current;
            const next = new Map(current);
            if (inset === 0) next.delete(owner);
            else next.set(owner, inset);
            return next;
        });
    }, []);
    const lift = Math.max(0, ...insets.values());
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
            <ToastInsetContext.Provider value={setInset}>{children}</ToastInsetContext.Provider>

            {/*
             * Pinned to the window on the web. The app's root view can be taller than the window,
             * and a region anchored to its foot put every toast below the fold, where nobody saw
             * it. `fixed` is web-only; native's root is the screen, so `absolute` is right there.
             *
             * One column holds both live regions, so a confirmation and a failure shown together
             * stack instead of drawing over each other.
             */}
            <View
                className="absolute bottom-4 end-4 start-4 z-50 flex-col gap-2 web:fixed web:bottom-6"
                style={lift === 0 ? undefined : { bottom: 24 + lift }}
                pointerEvents="box-none"
            >
                <View
                    testID="toast-region-polite"
                    role="status"
                    aria-live="polite"
                    accessibilityLiveRegion="polite"
                    className="flex-col gap-2"
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
                    className="flex-col gap-2"
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
    if (toast.look === 'card') {
        return <CardToast toast={toast} closeLabel={closeLabel} onDismiss={onDismiss} />;
    }
    if (toast.look === 'desk') {
        return <DeskToast toast={toast} closeLabel={closeLabel} onDismiss={onDismiss} />;
    }
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
                {toast.title === undefined ? toast.message : `${toast.title}. ${toast.message}`}
            </RNText>
            {toast.action === undefined ? null : (
                <Button
                    testID={toast.action.testID ?? `${toast.testID ?? `toast-${tone}`}-action`}
                    size="sm"
                    variant="secondary"
                    label={toast.action.label}
                    onPress={() => {
                        toast.action?.onPress();
                        onDismiss(toast.id);
                    }}
                />
            )}
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

/** The card look's colours per tone. Amber is the one tone that is not dark. */
interface CardTone {
    readonly card: string;
    readonly ink: string;
    readonly disc: string;
    readonly glyph: string;
    readonly bar: string;
    readonly action: string;
    readonly actionInk: string;
}

const DARK_CARD: CardTone = {
    card: 'bg-surface-inverse',
    ink: 'text-content-inverse',
    disc: 'bg-content-inverse/15',
    glyph: 'text-content-inverse',
    bar: 'bg-content-inverse/50',
    action: 'bg-content-inverse/15',
    actionInk: 'text-content-inverse',
};

const CARD_TONE: Readonly<Record<ToastTone, CardTone>> = {
    neutral: DARK_CARD,
    info: DARK_CARD,
    success: {
        ...DARK_CARD,
        disc: 'bg-stage-green',
        glyph: 'text-surface-canopy',
        bar: 'bg-stage-green',
    },
    warning: {
        card: 'bg-warning-subtle',
        ink: 'text-warning-on-subtle',
        disc: 'bg-warning-strong',
        glyph: 'text-warning-on-strong',
        bar: 'bg-warning-strong',
        action: 'bg-warning-on-subtle/10',
        actionInk: 'text-warning-on-subtle',
    },
    danger: {
        ...DARK_CARD,
        disc: 'bg-danger-strong',
        glyph: 'text-danger-on-strong',
        bar: 'bg-danger-strong',
        action: 'bg-danger-strong',
        actionInk: 'text-danger-on-strong',
    },
};

const CARD_ICON: Readonly<Record<ToastTone, IconName>> = {
    neutral: 'infoCircle',
    info: 'infoCircle',
    success: 'check',
    warning: 'alert',
    danger: 'circleX',
};

/**
 * The shop's toast: it rises into place, then a bar along its foot runs down for as long as it
 * stays. Reduced motion skips both — it simply appears, and goes.
 */
function CardToast({
    toast,
    closeLabel,
    onDismiss,
}: {
    readonly toast: Toast;
    readonly closeLabel: string;
    readonly onDismiss: (id: string) => void;
}) {
    const tone = toast.tone ?? 'neutral';
    const look = CARD_TONE[tone];
    const { enabled } = useMotion();
    const duration = toast.durationMs ?? DEFAULT_TOAST_DURATION_MS;
    const [rise] = useState(() => new Animated.Value(enabled ? 0 : 1));
    const [left] = useState(() => new Animated.Value(1));

    useEffect(() => {
        if (!enabled) return undefined;
        const steps = [
            Animated.timing(rise, {
                toValue: 1,
                duration: 500,
                easing: Easing.bezier(0.22, 1, 0.36, 1),
                useNativeDriver: Platform.OS !== 'web',
            }),
        ];
        if (duration > 0) {
            steps.push(
                Animated.timing(left, {
                    toValue: 0,
                    duration,
                    easing: Easing.linear,
                    useNativeDriver: false,
                }),
            );
        }
        const all = Animated.parallel(steps);
        all.start();
        return () => {
            all.stop();
        };
    }, [duration, enabled, left, rise]);

    const testID = toast.testID ?? `toast-${tone}`;
    return (
        <Animated.View
            testID={testID}
            className={cx(
                'w-full max-w-[440px] flex-row items-center gap-3 self-center overflow-hidden rounded-[18px] py-3 pe-3 ps-3.5 shadow-elevation-4',
                look.card,
            )}
            style={{
                opacity: rise,
                transform: [
                    { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
                    { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
                ],
            }}
        >
            {toast.image === undefined ? (
                <View
                    aria-hidden
                    className={cx(
                        'h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full',
                        look.disc,
                    )}
                >
                    <Icon name={CARD_ICON[tone]} size="md" className={look.glyph} />
                </View>
            ) : (
                <Image
                    source={toast.image}
                    alt=""
                    aria-hidden
                    resizeMode="cover"
                    style={{ width: 40, height: 40, borderRadius: 12 }}
                />
            )}
            <View className="min-w-0 flex-1 flex-col">
                {toast.title === undefined ? null : (
                    <RNText className={cx('text-sm font-bold text-start', look.ink)}>
                        {toast.title}
                    </RNText>
                )}
                <RNText
                    className={cx(
                        'text-start',
                        look.ink,
                        toast.title === undefined
                            ? 'text-sm font-semibold'
                            : 'text-xs font-medium opacity-75',
                    )}
                >
                    {toast.message}
                </RNText>
            </View>
            {toast.action === undefined ? null : (
                <Pressable
                    testID={toast.action.testID ?? `${testID}-action`}
                    role="button"
                    accessibilityRole="button"
                    onPress={() => {
                        toast.action?.onPress();
                        onDismiss(toast.id);
                    }}
                    className={cx(
                        'h-9 shrink-0 justify-center rounded-[10px] px-3 hover:opacity-80',
                        look.action,
                    )}
                >
                    <RNText className={cx('text-sm font-bold', look.actionInk)}>
                        {toast.action.label}
                    </RNText>
                </Pressable>
            )}
            <Pressable
                testID={`${testID}-dismiss`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                onPress={() => {
                    onDismiss(toast.id);
                }}
                className="h-9 w-9 shrink-0 items-center justify-center rounded-[10px] opacity-70 hover:opacity-100"
            >
                <Icon name="close" size="sm" className={look.ink} />
            </Pressable>
            {duration > 0 ? (
                <Animated.View
                    aria-hidden
                    className={cx('absolute bottom-0 start-0 h-[3px]', look.bar)}
                    style={{
                        width: left.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                        }),
                    }}
                />
            ) : null}
        </Animated.View>
    );
}

/** The desk look's tone tile — a soft disc of the tone with its glyph. */
const DESK_TILE: Readonly<Record<ToastTone, { readonly disc: string; readonly glyph: string }>> = {
    neutral: { disc: 'bg-surface-sunken', glyph: 'text-content-secondary' },
    info: { disc: 'bg-info-subtle', glyph: 'text-info-on-subtle' },
    success: { disc: 'bg-success-subtle', glyph: 'text-success-on-subtle' },
    warning: { disc: 'bg-warning-subtle', glyph: 'text-warning-on-subtle' },
    danger: { disc: 'bg-danger-subtle', glyph: 'text-danger-strong' },
};

/**
 * The kitchen admin's toast (Toasts / pop-ups / banners canvas, 2026-11-11):
 *
 * ```
 *  ┌──────────────────────────────────────────────┐
 *  │ (✓)  Supplier saved                 Show   × │   white card, one line, bottom centre
 *  └──────────────────────────────────────────────┘
 *  ┌──────────────────────────────────────────────┐
 *  │ ↻  Basmati rice archived               Undo   │   dark ink only for something you can
 *  │▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔                         │   take back, its time running out
 *  └──────────────────────────────────────────────┘
 * ```
 *
 * A failure keeps the white card with a red edge, so it is told apart by more than its tile. With
 * a `title` the message becomes the quieter second line — two lines at most.
 */
function DeskToast({
    toast,
    closeLabel,
    onDismiss,
}: {
    readonly toast: Toast;
    readonly closeLabel: string;
    readonly onDismiss: (id: string) => void;
}) {
    const tone = toast.tone ?? 'neutral';
    const undo = toast.undo === true;
    const tile = DESK_TILE[tone];
    const { enabled } = useMotion();
    const duration = toast.durationMs ?? DEFAULT_TOAST_DURATION_MS;
    const [rise] = useState(() => new Animated.Value(enabled ? 0 : 1));
    const [left] = useState(() => new Animated.Value(1));

    useEffect(() => {
        if (!enabled) return undefined;
        const steps = [
            Animated.timing(rise, {
                toValue: 1,
                duration: 320,
                easing: Easing.bezier(0.22, 1, 0.36, 1),
                useNativeDriver: Platform.OS !== 'web',
            }),
        ];
        if (undo && duration > 0) {
            steps.push(
                Animated.timing(left, {
                    toValue: 0,
                    duration,
                    easing: Easing.linear,
                    useNativeDriver: false,
                }),
            );
        }
        const all = Animated.parallel(steps);
        all.start();
        return () => {
            all.stop();
        };
    }, [duration, enabled, left, rise, undo]);

    const testID = toast.testID ?? `toast-${tone}`;
    const ink = undo ? 'text-content-inverse' : 'text-content-primary';
    return (
        <Animated.View
            testID={testID}
            className={cx(
                'w-full max-w-[440px] flex-row items-center gap-2.5 self-center overflow-hidden rounded-2xl py-2.5 pe-2.5 ps-3 shadow-elevation-4',
                undo
                    ? 'bg-surface-inverse'
                    : cx(
                          'border bg-surface-raised',
                          tone === 'danger' ? 'border-danger-border' : 'border-stroke-subtle',
                      ),
            )}
            style={{
                opacity: rise,
                transform: [
                    { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                ],
            }}
        >
            {undo ? (
                <Icon name="rotateCw" size="sm" className="text-content-inverse" />
            ) : (
                <View
                    aria-hidden
                    className={cx(
                        'h-7 w-7 shrink-0 items-center justify-center rounded-full',
                        tile.disc,
                    )}
                >
                    <Icon name={CARD_ICON[tone]} size="sm" className={tile.glyph} />
                </View>
            )}
            <View className="min-w-0 flex-1 flex-col gap-0.5">
                {toast.title === undefined ? null : (
                    <RNText className={cx('text-sm font-semibold text-start', ink)}>
                        {toast.title}
                    </RNText>
                )}
                <RNText
                    className={cx(
                        'text-start',
                        toast.title === undefined
                            ? cx('text-sm font-semibold', ink)
                            : 'text-xs text-content-secondary',
                    )}
                >
                    {toast.message}
                </RNText>
            </View>
            {toast.action === undefined ? null : (
                <Pressable
                    testID={toast.action.testID ?? `${testID}-action`}
                    role="button"
                    accessibilityRole="button"
                    onPress={() => {
                        toast.action?.onPress();
                        onDismiss(toast.id);
                    }}
                    className={cx(
                        'h-7 shrink-0 justify-center rounded-full px-2',
                        undo ? 'hover:bg-content-inverse/15' : 'hover:bg-surface-sunken',
                    )}
                >
                    <RNText
                        className={cx(
                            'text-sm font-bold',
                            undo
                                ? 'text-stage-green'
                                : tone === 'danger'
                                  ? 'text-danger-strong'
                                  : 'text-content-on-brand-subtle',
                        )}
                    >
                        {toast.action.label}
                    </RNText>
                </Pressable>
            )}
            <Pressable
                testID={`${testID}-dismiss`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                onPress={() => {
                    onDismiss(toast.id);
                }}
                className={cx(
                    'h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full',
                    undo ? 'hover:bg-content-inverse/15' : 'hover:bg-surface-sunken',
                )}
            >
                <Icon
                    name="close"
                    size="sm"
                    className={undo ? 'text-content-inverse' : 'text-content-secondary'}
                />
            </Pressable>
            {undo && duration > 0 ? (
                <Animated.View
                    aria-hidden
                    className="absolute bottom-0 start-0 h-[3px] bg-stage-green"
                    style={{
                        width: left.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                        }),
                    }}
                />
            ) : null}
        </Animated.View>
    );
}

export function useToast(): ToastApi {
    const api = useContext(ToastContext);
    const look = useContext(ToastLookContext);
    if (api === null) {
        throw new Error('useToast must be used inside a <ToastProvider>.');
    }
    // Under a scope, every toast takes its look unless the call names one itself.
    return useMemo(
        () =>
            look === 'default'
                ? api
                : { ...api, show: (options: ToastOptions) => api.show({ look, ...options }) },
        [api, look],
    );
}
