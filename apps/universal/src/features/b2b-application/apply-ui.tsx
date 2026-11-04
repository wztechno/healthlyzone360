import { Icon, cx } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { B2B_STEP_COUNT, B2B_STEP_SLUGS } from './sections.ts';
import type { B2BStepSlug } from './sections.ts';

/**
 * The business application boards' own pieces: the lime button that sits on the canopy band, the
 * rail of eight steps beside the form, and the card the step is drawn in.
 */

/** Each step's glyph, as the boards draw them in the rail's card head. */
export const STEP_ICONS: Readonly<Record<B2BStepSlug, IconName>> = {
    company: 'building',
    signatory: 'pen',
    'trade-terms': 'fileText',
    logistics: 'truck',
    contacts: 'users',
    locations: 'mapPin',
    documents: 'scrollText',
    review: 'circleCheck',
};

/** The board's lime-on-canopy call to action. */
export function CanopyButton({
    testID,
    label,
    busy = false,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly busy?: boolean;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={busy}
            aria-busy={busy}
            accessibilityState={{ disabled: busy, busy }}
            onPress={onPress}
            className="relative h-14 flex-row items-center gap-2.5 rounded-2xl bg-stage-green px-6 transition duration-normal ease-standard hover:-translate-y-0.5 active:opacity-85"
        >
            <View className={cx('flex-row items-center gap-2.5', busy ? 'opacity-0' : '')}>
                <RNText className="text-base font-bold text-surface-canopy">{label}</RNText>
                <Icon name="arrowForward" size="md" className="text-surface-canopy" />
            </View>
            {busy ? (
                <View className="absolute inset-0 items-center justify-center">
                    <ActivityIndicator size="small" />
                </View>
            ) : null}
        </Pressable>
    );
}

export type RailState = 'done' | 'current' | 'open' | 'locked';

/**
 * The board's rail: the eight steps, each a numbered disc and its name — the current one on the
 * brand's soft fill, a finished one ticked — and under them the position and a bar.
 */
export function StepRail({
    current,
    stateOf,
    labelOf,
    onOpen,
    testID,
}: {
    readonly current: B2BStepSlug;
    readonly stateOf: (slug: B2BStepSlug) => RailState;
    readonly labelOf: (slug: B2BStepSlug) => string;
    readonly onOpen: (slug: B2BStepSlug) => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const position = B2B_STEP_SLUGS.indexOf(current) + 1;
    return (
        <View
            testID={testID}
            role="navigation"
            aria-label={t('b2bApplication:title')}
            className="rounded-3xl border border-stroke-subtle bg-surface-raised p-2.5"
        >
            {B2B_STEP_SLUGS.map((slug, index) => {
                const state = stateOf(slug);
                const on = state === 'current';
                return (
                    <Pressable
                        key={slug}
                        testID={`${testID}-${slug}`}
                        role="link"
                        accessibilityRole="link"
                        aria-current={on ? 'step' : undefined}
                        disabled={state === 'locked' || on}
                        onPress={() => {
                            onOpen(slug);
                        }}
                        className={cx(
                            'min-h-12 flex-row items-center gap-2.5 rounded-[14px] px-2.5',
                            on ? 'bg-surface-brand-subtle' : 'hover:bg-surface-base',
                            state === 'locked' ? 'opacity-60' : '',
                        )}
                    >
                        <View
                            className={cx(
                                'h-7 w-7 items-center justify-center rounded-full border-2',
                                state === 'done'
                                    ? 'border-surface-brand bg-surface-brand'
                                    : on
                                      ? 'border-surface-brand bg-surface-raised'
                                      : 'border-stroke bg-surface-raised',
                            )}
                        >
                            {state === 'done' ? (
                                <Icon name="check" size="sm" className="text-content-on-brand" />
                            ) : (
                                <RNText
                                    className={cx(
                                        'text-xs font-bold',
                                        on
                                            ? 'text-content-on-brand-subtle'
                                            : 'text-content-secondary',
                                    )}
                                >
                                    {String(index + 1)}
                                </RNText>
                            )}
                        </View>
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'min-w-0 flex-1 text-sm font-semibold text-start',
                                on ? 'text-content-on-brand-subtle' : 'text-content-secondary',
                            )}
                        >
                            {labelOf(slug)}
                        </RNText>
                    </Pressable>
                );
            })}
            <View className="mx-1 mt-1.5 border-t border-stroke-subtle px-1.5 pb-1.5 pt-3">
                <RNText className="text-xs font-semibold text-content-secondary text-start">
                    {t('b2bApplication:wizard.stepPosition', {
                        position,
                        total: B2B_STEP_COUNT,
                    })}
                </RNText>
                <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-stroke-subtle">
                    <View
                        className="h-full rounded-full bg-surface-brand"
                        style={{ width: `${Math.round((position / B2B_STEP_COUNT) * 100)}%` }}
                    />
                </View>
            </View>
        </View>
    );
}

/** The card a step is drawn in: its glyph and name, then the step, then the footer row. */
export function StepCard({
    icon,
    title,
    titleTestID,
    lede,
    footer,
    children,
}: {
    readonly icon: IconName;
    readonly title: string;
    readonly titleTestID?: string | undefined;
    readonly lede?: string | undefined;
    readonly footer?: ReactNode;
    readonly children: ReactNode;
}) {
    return (
        <View className="min-w-0 rounded-3xl border border-stroke-subtle bg-surface-raised px-6 py-[22px]">
            <View className="flex-row items-center gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-[13px] bg-surface-base">
                    <Icon name={icon} size="md" className="text-content-on-brand-subtle" />
                </View>
                <RNText
                    testID={titleTestID}
                    accessibilityRole="header"
                    aria-level={1}
                    className="min-w-0 flex-1 font-display text-2xl font-bold text-content-primary text-start"
                >
                    {title}
                </RNText>
            </View>
            {lede === undefined ? null : (
                <RNText className="mt-2 text-sm font-medium leading-[21px] text-content-secondary text-start">
                    {lede}
                </RNText>
            )}
            <View className="mt-4">{children}</View>
            {footer === undefined ? null : (
                <View className="mt-[22px] flex-row flex-wrap items-center justify-between gap-3 border-t border-stroke-subtle pt-[18px]">
                    {footer}
                </View>
            )}
        </View>
    );
}

/** The soft text between a step's Back and its primary button. */
export function SavedAsYouGo() {
    const { t } = useTranslation();
    return (
        <RNText className="hidden text-sm font-medium text-content-secondary md:flex">
            {t('b2bApplication:wizard.savedAsYouGo')}
        </RNText>
    );
}
