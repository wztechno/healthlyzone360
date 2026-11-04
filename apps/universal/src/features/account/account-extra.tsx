import { Icon, cx } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { BackPill } from '../../ui/back-pill.tsx';

/**
 * The accepted boards' account extras — "Your mobile number", "Permissions", "Close your account" —
 * share one page: a back pill, a header (an icon tile beside a 32px title) and white cards under it,
 * at the boards' 880px. These are its pieces.
 */

export function ExtraPage({
    testID,
    backTestID,
    backLabel,
    onBack,
    icon,
    tone = 'brand',
    title,
    titleTestID,
    children,
}: {
    readonly testID: string;
    readonly backTestID: string;
    readonly backLabel: string;
    readonly onBack: () => void;
    readonly icon: IconName;
    readonly tone?: 'brand' | 'danger';
    readonly title: string;
    readonly titleTestID?: string | undefined;
    readonly children: ReactNode;
}) {
    return (
        <View testID={testID} className="w-full max-w-[880px] flex-col self-center pb-12">
            <View className="items-start pt-1">
                <BackPill testID={backTestID} label={backLabel} onPress={onBack} />
            </View>
            <View className="mt-[18px] flex-row items-center gap-4">
                <View
                    aria-hidden
                    className={cx(
                        'h-14 w-14 shrink-0 items-center justify-center rounded-[18px]',
                        tone === 'danger' ? 'bg-danger-subtle' : 'bg-surface-brand-subtle',
                    )}
                >
                    <Icon
                        name={icon}
                        size="lg"
                        className={
                            tone === 'danger'
                                ? 'text-danger-on-subtle'
                                : 'text-content-on-brand-subtle'
                        }
                    />
                </View>
                <RNText
                    testID={titleTestID}
                    accessibilityRole="header"
                    aria-level={1}
                    className="min-w-0 flex-1 font-display text-3xl font-bold leading-[38px] text-content-primary text-start"
                >
                    {title}
                </RNText>
            </View>
            {children}
        </View>
    );
}

export function ExtraCard({
    testID,
    title,
    children,
    className,
}: {
    readonly testID?: string | undefined;
    readonly title?: string | undefined;
    readonly children: ReactNode;
    readonly className?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className={cx(
                'mt-[18px] rounded-3xl border border-stroke-subtle bg-surface-raised px-6 py-[22px]',
                className,
            )}
        >
            {title === undefined ? null : (
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="mb-1 text-lg font-bold text-content-primary text-start"
                >
                    {title}
                </RNText>
            )}
            {children}
        </View>
    );
}

/** The boards' buttons: the 54px brand (or danger) block, and its quiet secondary. */
export function ExtraButton({
    testID,
    label,
    tone = 'brand',
    busy = false,
    disabled = false,
    icon,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly tone?: 'brand' | 'danger' | 'secondary';
    readonly busy?: boolean;
    readonly disabled?: boolean;
    readonly icon?: IconName | undefined;
    readonly onPress: () => void;
}) {
    const inert = busy || disabled;
    const ink =
        tone === 'secondary'
            ? 'text-content-primary'
            : tone === 'danger'
              ? 'text-content-inverse'
              : 'text-content-on-brand';
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={inert}
            aria-disabled={inert}
            aria-busy={busy}
            accessibilityState={{ disabled: inert, busy }}
            onPress={onPress}
            className={cx(
                'h-[54px] flex-row items-center justify-center gap-2.5 rounded-2xl px-5',
                tone === 'secondary'
                    ? 'border border-stroke bg-surface-raised hover:bg-surface-brand-subtle'
                    : tone === 'danger'
                      ? 'bg-danger hover:opacity-90'
                      : 'bg-surface-brand hover:opacity-90',
                disabled ? 'opacity-45' : '',
            )}
        >
            {busy ? (
                <ActivityIndicator size="small" />
            ) : (
                <>
                    <RNText className={cx('text-base font-bold', ink)}>{label}</RNText>
                    {icon === undefined ? null : <Icon name={icon} size="md" className={ink} />}
                </>
            )}
        </Pressable>
    );
}

/** The boards' small 38px row button — Agree, Withdraw. */
export function ExtraSmallButton({
    testID,
    label,
    tone = 'brand',
    busy = false,
    disabled = false,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly tone?: 'brand' | 'secondary';
    readonly busy?: boolean;
    readonly disabled?: boolean;
    readonly onPress: () => void;
}) {
    const inert = busy || disabled;
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={inert}
            aria-disabled={inert}
            aria-busy={busy}
            accessibilityState={{ disabled: inert, busy }}
            onPress={onPress}
            className={cx(
                'h-[38px] min-w-[72px] flex-row items-center justify-center rounded-xl border px-3.5',
                tone === 'brand'
                    ? 'border-surface-brand bg-surface-brand'
                    : 'border-stroke bg-surface-raised hover:bg-surface-brand-subtle',
                disabled ? 'opacity-45' : '',
            )}
        >
            {busy ? (
                <ActivityIndicator size="small" />
            ) : (
                <RNText
                    className={cx(
                        'text-sm font-semibold',
                        tone === 'brand' ? 'text-content-on-brand' : 'text-content-primary',
                    )}
                >
                    {label}
                </RNText>
            )}
        </Pressable>
    );
}

/** A state chip — Confirmed, Not confirmed, Required. */
export function ExtraChip({
    testID,
    tone,
    label,
}: {
    readonly testID?: string | undefined;
    readonly tone: 'ok' | 'amber' | 'bad' | 'mute';
    readonly label: string;
}) {
    return (
        <View
            className={cx(
                'h-7 shrink-0 flex-row items-center rounded-full px-2.5',
                tone === 'ok'
                    ? 'bg-surface-brand-subtle'
                    : tone === 'amber'
                      ? 'bg-warning-subtle'
                      : tone === 'bad'
                        ? 'bg-danger-subtle'
                        : 'border border-stroke-subtle bg-surface-base',
            )}
        >
            <RNText
                testID={testID}
                className={cx(
                    'text-xs font-bold',
                    tone === 'ok'
                        ? 'text-content-on-brand-subtle'
                        : tone === 'amber'
                          ? 'text-warning-on-subtle'
                          : tone === 'bad'
                            ? 'text-danger-on-subtle'
                            : 'text-content-secondary',
                )}
            >
                {label}
            </RNText>
        </View>
    );
}

/** An inline text action in brand ink — "Send a new code", "Change number". */
export function ExtraLink({
    testID,
    label,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            onPress={onPress}
            className="min-h-touch justify-center self-start"
        >
            <RNText className="text-sm font-semibold text-content-on-brand-subtle hover:underline">
                {label}
            </RNText>
        </Pressable>
    );
}
