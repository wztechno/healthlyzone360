import { FAILURE_MESSAGE_KEYS, Icon, Skeleton, cx, useBreakpoint } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { ApiFailure } from '@healthy360/api-client';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

/**
 * The shop's empty, not-found and error states — the "Shop states" boards, now spread over the
 * pages they belong to (Menu 9–11, Meal page 3, Kitchens 6–9, Weekly plans 2–4, …).
 *
 * One card: a round icon disc ringed by a dashed circle, the title in the display face, one
 * sentence, and the way on. `tone` tints the disc — amber when the person can fix it, red when
 * something broke. `small` drops the card's frame and shrinks the disc, for a state inside a panel
 * (Account → Orders, a kitchen's Plans tab).
 */
export type ShopStateTone = 'brand' | 'warning' | 'danger';

const DISC: Readonly<Record<ShopStateTone, { fill: string; ink: string }>> = {
    brand: { fill: 'bg-surface-brand-subtle', ink: 'text-content-on-brand-subtle' },
    warning: { fill: 'bg-warning-subtle', ink: 'text-warning-on-subtle' },
    danger: { fill: 'bg-danger-subtle', ink: 'text-danger-on-subtle' },
};

export interface ShopStateCardProps {
    readonly icon: IconName;
    readonly title: string;
    readonly body?: string | undefined;
    /** `ShopStateButton`s — or any control a caller already has. */
    readonly actions?: ReactNode | undefined;
    /** Under the actions — an error's reference. */
    readonly footer?: ReactNode | undefined;
    readonly tone?: ShopStateTone | undefined;
    readonly small?: boolean | undefined;
    readonly role?: 'region' | 'alert' | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

export function ShopStateCard({
    icon,
    title,
    body,
    actions,
    footer,
    tone = 'brand',
    small = false,
    role = 'region',
    className,
    testID,
}: ShopStateCardProps) {
    const disc = DISC[tone];
    return (
        <View
            testID={testID}
            role={role}
            accessibilityRole={role === 'alert' ? 'alert' : undefined}
            accessibilityLabel={role === 'region' ? title : undefined}
            className={cx(
                'w-full items-center gap-3',
                small
                    ? 'px-[18px] py-[26px]'
                    : 'rounded-[28px] border border-stroke-subtle bg-surface-raised px-6 pb-12 pt-[52px] shadow-elevation-2',
                className,
            )}
        >
            <View
                className={cx(
                    'items-center justify-center',
                    small ? 'h-[78px] w-[78px]' : 'h-[124px] w-[124px]',
                )}
            >
                <View
                    aria-hidden
                    className="absolute inset-0 rounded-full border-2 border-dashed border-stroke opacity-80"
                />
                <View
                    aria-hidden
                    className={cx(
                        'items-center justify-center rounded-full',
                        small ? 'h-16 w-16' : 'h-[104px] w-[104px]',
                        disc.fill,
                    )}
                >
                    <Icon
                        name={icon}
                        size="lg"
                        className={cx(disc.ink, small ? 'scale-125' : 'scale-[1.7]')}
                    />
                </View>
            </View>
            <RNText
                testID={testID === undefined ? undefined : `${testID}-title`}
                accessibilityRole="header"
                aria-level={2}
                className={cx(
                    'mt-2 max-w-[560px] font-display font-bold text-content-primary text-center',
                    small ? 'text-xl leading-[25px]' : 'text-2xl leading-8',
                )}
            >
                {title}
            </RNText>
            {body === undefined ? null : (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-body`}
                    className={cx(
                        'max-w-[460px] leading-6 text-content-secondary text-center',
                        small ? 'text-sm' : 'text-base',
                    )}
                >
                    {body}
                </RNText>
            )}
            {actions === undefined ? null : (
                <View className="mt-2.5 w-full flex-row flex-wrap justify-center gap-2 sm:w-auto">
                    {actions}
                </View>
            )}
            {footer}
        </View>
    );
}

export interface ShopStateButtonProps {
    readonly label: string;
    readonly onPress: () => void;
    readonly kind?: 'brand' | 'secondary' | undefined;
    readonly icon?: IconName | undefined;
    /** The icon after the label — an arrow onwards — rather than before it. */
    readonly iconAfter?: boolean | undefined;
    readonly busy?: boolean | undefined;
    readonly testID?: string | undefined;
}

export function ShopStateButton({
    label,
    onPress,
    kind = 'brand',
    icon,
    iconAfter = false,
    busy = false,
    testID,
}: ShopStateButtonProps) {
    const brand = kind === 'brand';
    const ink = brand ? 'text-content-on-brand' : 'text-content-primary';
    const glyph = busy ? (
        <ActivityIndicator size="small" />
    ) : icon === undefined ? null : (
        <Icon name={icon} size="md" className={ink} />
    );
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: busy }}
            aria-busy={busy}
            disabled={busy}
            onPress={onPress}
            className={cx(
                'h-[50px] flex-1 flex-row items-center justify-center gap-2 rounded-[15px] px-[22px] sm:flex-none',
                brand
                    ? 'bg-surface-brand hover:opacity-90'
                    : 'border border-stroke bg-surface-raised hover:bg-surface-sunken',
            )}
        >
            {iconAfter ? null : glyph}
            <RNText className={cx('text-base font-bold', ink)}>{label}</RNText>
            {iconAfter ? glyph : null}
        </Pressable>
    );
}

export interface ShopErrorCardProps {
    readonly failure: ApiFailure;
    readonly title?: string | undefined;
    readonly onRetry?: (() => void) | undefined;
    readonly retrying?: boolean | undefined;
    readonly small?: boolean | undefined;
    readonly testID?: string | undefined;
}

/**
 * A list that failed to load (Menu, pin 10): a red disc, "Something went wrong", what the server's
 * code means in words, Try again when trying again could work, and the reference that ties what the
 * person saw to what the server logged. The rules are the design system's `ErrorState`'s, and so
 * are the testIDs (`-title`, `-body`, `-correlation`, `-retry`).
 */
export function ShopErrorCard({
    failure,
    title,
    onRetry,
    retrying = false,
    small,
    testID,
}: ShopErrorCardProps) {
    const { t } = useTranslation();
    const retryable = failure.retryable && onRetry !== undefined;
    const body = t(FAILURE_MESSAGE_KEYS[failure.code], {
        defaultValue: failure.message,
        ...(failure.code === 'rate_limit.exceeded' ? { seconds: failure.retryAfterSeconds } : {}),
    });
    return (
        <ShopStateCard
            testID={testID}
            role="alert"
            tone="danger"
            icon="cloudAlert"
            small={small}
            title={title ?? t('errors:generic.title')}
            body={body}
            actions={
                retryable ? (
                    <ShopStateButton
                        testID={testID === undefined ? undefined : `${testID}-retry`}
                        kind="secondary"
                        icon="rotateCw"
                        label={t('errors:generic.retry')}
                        busy={retrying}
                        onPress={onRetry}
                    />
                ) : undefined
            }
            footer={
                failure.correlationId === null ? undefined : (
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-correlation`}
                        selectable
                        className="mt-1 text-xs tabular-nums text-content-secondary text-center"
                    >
                        {t('errors:generic.reference', { id: failure.correlationId })}
                    </RNText>
                )
            }
        />
    );
}

/**
 * Grey cards while a card list loads (Menu, pin 11): the photo, two lines, the four nutrient cells
 * and the price row, shimmering — so the page does not reflow when the real cards land.
 */
export function ShopCardSkeletons({
    count,
    testID,
}: {
    readonly count: number;
    readonly testID: string;
}) {
    const { atLeast } = useBreakpoint();
    const columns = atLeast('xl') ? 4 : atLeast('lg') ? 3 : atLeast('sm') ? 2 : 1;
    const rows: number[][] = [];
    for (let index = 0; index < count; index += columns) {
        rows.push(Array.from({ length: Math.min(columns, count - index) }, (_, k) => index + k));
    }
    return (
        <View testID={testID} aria-busy className="flex-col gap-4">
            {rows.map((row) => (
                <View key={row[0]} className="flex-row gap-4">
                    {row.map((index) => (
                        <View
                            key={index}
                            aria-hidden
                            className="min-w-0 flex-1 overflow-hidden rounded-[22px] border border-stroke-subtle bg-surface-raised"
                        >
                            <Skeleton
                                testID={`${testID.replace(/-loading$/, '')}-skeleton-${String(index + 1)}`}
                                heightClassName="h-40"
                                variant="shimmer"
                                className="rounded-none"
                            />
                            <View className="flex-col gap-2.5 p-4">
                                <Skeleton
                                    heightClassName="h-3.5"
                                    widthClassName="w-[70%]"
                                    variant="shimmer"
                                />
                                <Skeleton
                                    heightClassName="h-3.5"
                                    widthClassName="w-[45%]"
                                    variant="shimmer"
                                />
                                <View className="flex-row gap-1.5">
                                    {[0, 1, 2, 3].map((cell) => (
                                        <View key={cell} className="flex-1">
                                            <Skeleton heightClassName="h-10" variant="shimmer" />
                                        </View>
                                    ))}
                                </View>
                                <View className="mt-1.5 flex-row items-center justify-between">
                                    <Skeleton
                                        heightClassName="h-[18px]"
                                        widthClassName="w-16"
                                        variant="shimmer"
                                    />
                                    <Skeleton
                                        heightClassName="h-10"
                                        widthClassName="w-10"
                                        rounded="full"
                                        variant="shimmer"
                                    />
                                </View>
                            </View>
                        </View>
                    ))}
                    {Array.from({ length: columns - row.length }, (_, k) => (
                        <View key={`gap-${String(k)}`} className="min-w-0 flex-1" />
                    ))}
                </View>
            ))}
        </View>
    );
}
