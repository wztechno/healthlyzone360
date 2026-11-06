import { Button, Icon, cx } from '@healthy360/design-system';
import type { Subscription, SubscriptionFilter } from '@healthy360/api-client/contracts';
import type { SubscriptionState } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import {
    usePauseSubscriptionMutation,
    useResumeSubscriptionMutation,
    useSubscriptionDaysQuery,
    useSubscriptionsQuery,
} from '../../../data/commerce-hooks.ts';
import { mealsFromPages, useMealsQuery, usePlanQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { withQuery } from '../../../navigation/return-to.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { ACCOUNT_CARD, PanelHead } from '../../account/account-card.tsx';
import { subscriptionDayPrice } from '../../catalogue/plan-balance.ts';
import { isLiveSubscription } from '../../catalogue/plan-subscription.ts';
import { TINT_FILL, TINT_INK } from '../../catalogue/shelf-tints.ts';
import type { ShelfTint } from '../../catalogue/shelf-tints.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { Bone } from '../../../ui/shop-skeletons.tsx';
import { bandLabel, mealsLine, slotName } from '../configurator-steps.tsx';
import { todayIso } from '../dates.ts';
import { deliverySlotsForKitchen } from '../delivery.ts';
import { canPauseOrSkip, canResume, isTerminalSubscriptionState } from '../state-badge.tsx';
import { estimatedEndDate } from '../subscription-board.ts';
import { PauseResumeDialog, shortWeekday } from '../subscription-editors.tsx';

/**
 * `/customer/subscriptions` — every subscription this person has, drawn as the account page's
 * Subscriptions section in the accepted Account board's card.
 *
 * ## One card per plan
 *
 * A tinted head (the plan's name, which opens it, its band and meals, the state, the day price),
 * then the run — "Day 6 of 28", a bar, when it should end — three facts (next delivery, where it
 * goes, which days), the week ahead with the meals chosen for each day, and the three things a
 * person most often comes here to do: change the meals, pause (or resume), skip a day. Change meals
 * and Skip a day open the subscription's own page on that control; Pause and Resume happen here,
 * through the same consequence-stating dialogs the page uses.
 *
 * ## The filter is over states, not over a search box
 *
 * A person has a handful of subscriptions, not hundreds. What they do have is a *lifecycle* — live,
 * paused, finished — so the four groups map onto `SUBSCRIPTION_STATES`, and `skipped_today` sits
 * with `active` because a subscription that skipped today is still delivering. The group is in the
 * URL as `?status=`, so Back and a refresh keep it.
 *
 * ## Every card says what is left of the balance
 *
 * The days are on `Subscription` itself rather than behind `getSubscriptionBalance`, so the list
 * costs one request rather than one per card.
 */

const FILTERS = ['all', 'live', 'paused', 'ended'] as const;
type FilterKey = (typeof FILTERS)[number];

function isFilterKey(value: unknown): value is FilterKey {
    return typeof value === 'string' && (FILTERS as readonly string[]).includes(value);
}

const FILTER_STATES: Readonly<Record<FilterKey, readonly SubscriptionState[]>> = {
    all: [],
    live: ['active', 'skipped_today'],
    paused: ['paused'],
    ended: ['cancelled', 'expired'],
};

/** The card heads' tints, in turn. */
const TINTS: readonly ShelfTint[] = ['green', 'orange', 'blue', 'violet'];

/** How many days the "This week" strip shows. */
const WEEK_DAYS = 5;

export interface SubscriptionsScreenProps {
    /**
     * Drawn as a section of the account page. Kept for the route that used to own it; the card is
     * the same either way.
     */
    readonly embedded?: boolean | undefined;
}

export function SubscriptionsScreen(_props: SubscriptionsScreenProps = {}) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const params = useLocalSearchParams<{ status?: string | string[] }>();
    const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status;
    // An unknown `?status=` lists everything.
    const requested: FilterKey = isFilterKey(rawStatus) ? rawStatus : 'all';
    const [filter, setFilter] = useState<FilterKey>(requested);
    // Follow the URL when it changes underneath the list — Back onto an entry with another group.
    // Adjusted during render rather than in an effect, so the list never paints the old group.
    const [followed, setFollowed] = useState<FilterKey>(requested);
    if (followed !== requested) {
        setFollowed(requested);
        setFilter(requested);
    }
    const chooseFilter = (next: FilterKey) => {
        setFilter(next);
        router.setParams({ status: next === 'all' ? undefined : next } as never);
    };
    const states = FILTER_STATES[filter];
    const request: SubscriptionFilter = states.length === 0 ? {} : { states };

    const subscriptions = useSubscriptionsQuery(request);
    const items: readonly Subscription[] = subscriptions.data?.items ?? [];
    const active = items.filter(isLiveSubscription).length;

    const browse = () => {
        router.push('/plans');
    };

    return (
        <View testID="subscriptions-screen" className={`${ACCOUNT_CARD} p-6`}>
            <PanelHead
                testID="subscriptions-title"
                title={t('commerce:subscriptions.title')}
                {...(active === 0
                    ? {}
                    : {
                          count: t('commerce:subscriptions.activeCount', {
                              count: active,
                              formatted: formatter.formatNumber(active),
                          }),
                      })}
                end={
                    items.length === 0 ? undefined : (
                        <Pressable
                            testID="subscriptions-browse"
                            role="link"
                            accessibilityRole="link"
                            onPress={browse}
                            className="h-10 flex-row items-center gap-1.5 rounded-xl border border-stroke bg-surface-raised px-3.5 hover:bg-surface-brand-subtle"
                        >
                            <RNText className="text-sm font-semibold text-content-primary">
                                {t('commerce:subscriptions.browseShort')}
                            </RNText>
                        </Pressable>
                    )
                }
            />

            <View
                testID="subscriptions-filter"
                role="tablist"
                aria-label={t('commerce:subscriptions.filterLabel')}
                className="mb-4 flex-row flex-wrap gap-1.5"
            >
                {FILTERS.map((key) => {
                    const on = key === filter;
                    return (
                        <Pressable
                            key={key}
                            testID={`subscriptions-filter-${key}`}
                            role="tab"
                            aria-selected={on}
                            accessibilityState={{ selected: on }}
                            onPress={() => {
                                chooseFilter(key);
                            }}
                            className={cx(
                                'h-9 justify-center rounded-full border px-3.5',
                                on
                                    ? 'border-content-primary bg-content-primary'
                                    : 'border-stroke-subtle bg-surface-raised hover:bg-surface-sunken',
                            )}
                        >
                            <RNText
                                className={cx(
                                    'text-sm font-semibold',
                                    on ? 'text-surface-base' : 'text-content-secondary',
                                )}
                            >
                                {t(`commerce:subscriptions.filters.${key}`)}
                            </RNText>
                        </Pressable>
                    );
                })}
            </View>

            <QueryStates
                query={subscriptions}
                isEmpty={items.length === 0}
                emptyTitle={
                    filter === 'all'
                        ? t('commerce:subscriptions.emptyTitle')
                        : t('commerce:subscriptions.emptyFilteredTitle')
                }
                emptyBody={
                    filter === 'all'
                        ? t('commerce:subscriptions.emptyBody')
                        : t('commerce:subscriptions.emptyFilteredBody')
                }
                emptyActions={
                    filter === 'all' ? (
                        <Button
                            testID="subscriptions-browse"
                            label={t('commerce:subscriptions.browse')}
                            onPress={browse}
                        />
                    ) : (
                        <Button
                            testID="subscriptions-clear-filter"
                            variant="secondary"
                            label={t('commerce:subscriptions.clearFilter')}
                            onPress={() => {
                                chooseFilter('all');
                            }}
                        />
                    )
                }
                loading={
                    <View className="flex-col gap-4">
                        <SubscriptionCardSkeleton />
                        <SubscriptionCardSkeleton />
                    </View>
                }
                testID="subscriptions"
            >
                <View testID="subscriptions-list" className="flex-col gap-4">
                    {items.map((subscription, index) => (
                        <SubscriptionCard
                            key={subscription.id}
                            subscription={subscription}
                            tint={TINTS[index % TINTS.length] ?? 'green'}
                        />
                    ))}
                </View>
            </QueryStates>
        </View>
    );
}

/* ── one subscription, loading: the card's own outline ──────────────────────────────────────── */

function SubscriptionCardSkeleton() {
    return (
        <View className="flex-col overflow-hidden rounded-3xl border border-stroke-subtle bg-surface-raised">
            <View className={cx('flex-row items-center gap-4 p-5', TINT_FILL.green)}>
                <Bone heightClassName="h-14" widthClassName="w-14" />
                <View className="min-w-0 flex-1 gap-2">
                    <Bone heightClassName="h-6" widthClassName="w-1/2" />
                    <View className="flex-row gap-1.5">
                        <Bone heightClassName="h-6" widthClassName="w-24" rounded="full" />
                        <Bone heightClassName="h-6" widthClassName="w-24" rounded="full" />
                    </View>
                </View>
                <View className="items-end gap-1.5">
                    <Bone heightClassName="h-8" widthClassName="w-20" />
                    <Bone heightClassName="h-3" widthClassName="w-10" />
                </View>
            </View>
            <View className="flex-col gap-[18px] p-5">
                <View className="flex-row items-center gap-3">
                    <Bone heightClassName="h-4" widthClassName="w-20" />
                    <Bone heightClassName="h-2.5" rounded="full" className="flex-1" />
                </View>
                <View className="flex-col gap-2.5 sm:flex-row">
                    {[0, 1, 2].map((index) => (
                        <View
                            key={index}
                            className="min-w-0 flex-1 gap-2 rounded-2xl bg-surface-base px-3.5 py-3"
                        >
                            <Bone heightClassName="h-3" widthClassName="w-1/3" />
                            <Bone heightClassName="h-4" widthClassName="w-2/3" />
                        </View>
                    ))}
                </View>
                <View className="flex-row gap-2">
                    <Bone heightClassName="h-10" widthClassName="w-36" rounded="full" />
                    <Bone heightClassName="h-10" widthClassName="w-24" rounded="full" />
                </View>
            </View>
        </View>
    );
}

/* ── one subscription ────────────────────────────────────────────────────────────────────────── */

function SubscriptionCard({
    subscription,
    tint,
}: {
    readonly subscription: Subscription;
    readonly tint: ShelfTint;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const id = `subscription-row-${String(subscription.id)}`;
    const href = `/customer/subscriptions/${String(subscription.id)}`;
    const ended = isTerminalSubscriptionState(subscription.state);

    const plan = usePlanQuery(subscription.configuration.planId);
    const variant = plan.data?.variants.find(
        (each) => each.id === subscription.configuration.variantId,
    );
    const kitchen = useKitchenQuery(subscription.kitchenId);
    const slots = deliverySlotsForKitchen(kitchen.data);
    const slot = slots.find((each) => each.code === subscription.configuration.slotCode);

    const { total, consumed } = subscription.days;
    const day = ended ? consumed : Math.min(total, consumed + 1);
    const ends = estimatedEndDate(subscription);
    const address = subscription.configuration.address;

    const [dialog, setDialog] = useState<'pause' | 'resume' | null>(null);
    const pause = usePauseSubscriptionMutation();
    const resume = useResumeSubscriptionMutation();
    const busy = pause.isPending || resume.isPending;
    const close = () => {
        setDialog(null);
    };

    return (
        <View
            testID={id}
            className="flex-col overflow-hidden rounded-3xl border border-stroke-subtle"
        >
            {/* ── the head, on the plan's tint ──────────────────────────────────────────────── */}
            <View className={cx('flex-row flex-wrap items-center gap-4 p-5', TINT_FILL[tint])}>
                <View className="h-14 w-14 items-center justify-center rounded-[18px] bg-surface-raised">
                    <Icon name="calendar" size="lg" className={TINT_INK[tint]} />
                </View>
                <View className="min-w-0 flex-1">
                    <Pressable
                        testID={`${id}-open`}
                        role="link"
                        accessibilityRole="link"
                        onPress={() => {
                            router.push(href as never);
                        }}
                        className="self-start"
                    >
                        <RNText className="font-display text-2xl font-bold tracking-display text-content-primary hover:underline text-start">
                            {subscription.planName}
                        </RNText>
                    </Pressable>
                    {variant === undefined ? null : (
                        <View className="mt-2 flex-row flex-wrap gap-1.5">
                            <HeadChip
                                label={t('commerce:subscriptions.bandDay', {
                                    band: bandLabel(variant, formatter.formatNumber, t),
                                })}
                            />
                            <HeadChip label={mealsLine(variant, formatter.formatNumber, t)} />
                        </View>
                    )}
                </View>
                <View
                    testID={`${id}-state`}
                    className="h-[26px] flex-row items-center gap-1.5 rounded-full bg-surface-raised px-2.5"
                >
                    <View
                        className={cx(
                            'h-2 w-2 rounded-full',
                            subscription.state === 'paused'
                                ? 'bg-stage-orange'
                                : ended
                                  ? 'bg-stroke-strong'
                                  : 'bg-surface-brand',
                        )}
                    />
                    <RNText className="text-xs font-bold text-content-primary">
                        {t(`commerce:states.${subscription.state}`)}
                    </RNText>
                </View>
                <View className="items-end">
                    <RNText
                        className={cx(
                            'font-display text-3xl font-bold tabular-nums',
                            TINT_INK[tint],
                        )}
                    >
                        {formatMoney(formatter, subscriptionDayPrice(subscription))}
                    </RNText>
                    <RNText className={cx('text-xs', TINT_INK[tint])}>
                        {t('commerce:subscriptions.aDay')}
                    </RNText>
                </View>
            </View>

            {/* ── the run, the facts, the week, the actions ─────────────────────────────────── */}
            <View className="flex-col gap-[18px] p-5">
                <View testID={`${id}-balance`} className="flex-row items-center gap-3">
                    <RNText className="text-sm font-bold tabular-nums text-content-primary">
                        {t('commerce:subscriptions.dayOf', {
                            day: formatter.formatNumber(day),
                            total: formatter.formatNumber(total),
                        })}
                    </RNText>
                    <View className="h-2.5 flex-1 flex-row overflow-hidden rounded-full bg-surface-base">
                        <View
                            className="h-full rounded-full bg-surface-brand"
                            style={{ flex: total === 0 ? 0 : consumed }}
                        />
                        <View style={{ flex: Math.max(0, total - consumed) }} />
                    </View>
                    {ends === null ? null : (
                        <RNText className="text-sm text-content-secondary">
                            {t('commerce:subscriptions.ends', {
                                date: formatter.formatDate(ends, {
                                    weekday: 'short',
                                    day: 'numeric',
                                    month: 'short',
                                }),
                            })}
                        </RNText>
                    )}
                </View>

                <View className="flex-col gap-2.5 sm:flex-row">
                    <Fact
                        testID={`${id}-next`}
                        label={t('commerce:subscriptions.facts.next')}
                        value={
                            subscription.nextDeliveryDate === null
                                ? t('commerce:subscriptions.noNextDelivery')
                                : `${formatter.formatDate(subscription.nextDeliveryDate, {
                                      weekday: 'short',
                                      day: 'numeric',
                                      month: 'short',
                                  })} · ${slotName(slot, subscription.configuration.slotCode, t)}`
                        }
                    />
                    <Fact
                        label={t('commerce:subscriptions.facts.deliverTo')}
                        value={[address.label, address.area]
                            .filter((part) => part.trim() !== '')
                            .join(' · ')}
                    />
                    <Fact
                        label={t('commerce:subscriptions.facts.days')}
                        value={[...subscription.configuration.deliveryWeekdays]
                            .sort((a, b) => a - b)
                            .map((weekday) => shortWeekday(weekday, formatter.formatDate))
                            .join(t('commerce:common.listSeparator'))}
                    />
                </View>

                {ended ? null : <ThisWeek subscription={subscription} testID={`${id}-week`} />}

                {ended ? null : (
                    <View className="flex-row flex-wrap gap-2">
                        <CardAction
                            testID={`${id}-meals`}
                            label={t('commerce:subscriptions.changeMeals')}
                            icon="utensils"
                            tone="primary"
                            onPress={() => {
                                router.push(withQuery(href, { meals: '1' }) as never);
                            }}
                        />
                        {canPauseOrSkip(subscription.state) ? (
                            <CardAction
                                testID={`${id}-pause`}
                                label={t('commerce:subscription.pause')}
                                disabled={busy}
                                onPress={() => {
                                    pause.reset();
                                    setDialog('pause');
                                }}
                            />
                        ) : null}
                        {canResume(subscription.state) ? (
                            <CardAction
                                testID={`${id}-resume`}
                                label={t('commerce:subscription.resume')}
                                disabled={busy}
                                onPress={() => {
                                    resume.reset();
                                    setDialog('resume');
                                }}
                            />
                        ) : null}
                        {canPauseOrSkip(subscription.state) ? (
                            <CardAction
                                testID={`${id}-skip`}
                                label={t('commerce:subscription.board.skipDay')}
                                onPress={() => {
                                    router.push(withQuery(href, { skip: '1' }) as never);
                                }}
                            />
                        ) : null}
                    </View>
                )}
            </View>

            {/* Shop · Subscription, pins 8 and 9: the same pop-ups as the subscription page. */}
            {(['pause', 'resume'] as const).map((kind) => {
                const mutation = kind === 'pause' ? pause : resume;
                return (
                    <PauseResumeDialog
                        key={kind}
                        kind={kind}
                        testID={`${id}-${kind}`}
                        open={dialog === kind}
                        subject={{
                            planName: subscription.planName,
                            state: subscription.state,
                            kitchenName: kitchen.data?.name,
                        }}
                        pending={mutation.isPending}
                        error={mutation.error}
                        onClose={close}
                        onConfirm={() => {
                            if (kind === 'pause') {
                                pause.mutate(
                                    { subscriptionId: subscription.id },
                                    { onSuccess: close },
                                );
                            } else {
                                resume.mutate(subscription.id, { onSuccess: close });
                            }
                        }}
                    />
                );
            })}
        </View>
    );
}

/** A chip on the head's tint. */
function HeadChip({ label }: { readonly label: string }) {
    return (
        <View className="h-7 justify-center rounded-full bg-surface-raised px-[11px]">
            <RNText className="text-xs font-semibold text-content-primary">{label}</RNText>
        </View>
    );
}

function Fact({
    testID,
    label,
    value,
}: {
    readonly testID?: string;
    readonly label: string;
    readonly value: string;
}) {
    return (
        <View className="min-w-0 flex-1 rounded-2xl bg-surface-base px-3.5 py-3">
            <RNText className="text-xs font-semibold uppercase tracking-wider text-content-secondary text-start">
                {label}
            </RNText>
            <RNText
                testID={testID}
                className="mt-1 text-base font-bold text-content-primary text-start"
            >
                {value}
            </RNText>
        </View>
    );
}

/**
 * The days ahead and the meals chosen for each — read from the subscription's own days, with the
 * pictures from its kitchen's menu. Drawn only once there is a day to show.
 */
function ThisWeek({
    subscription,
    testID,
}: {
    readonly subscription: Subscription;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const today = todayIso();
    const days = useSubscriptionDaysQuery(subscription.id);
    const meals = useMealsQuery(
        { kitchenIds: [subscription.kitchenId], itemTypes: ['meal'], limit: 50 },
        days.data !== undefined && days.data.days.length > 0,
    );
    const menu = useMemo(
        () => new Map(mealsFromPages(meals.data?.pages).map((meal) => [String(meal.id), meal])),
        [meals.data],
    );
    const week = (days.data?.days ?? []).filter((day) => day.date >= today).slice(0, WEEK_DAYS);
    if (week.length === 0) return null;

    return (
        <View testID={testID}>
            <RNText className="mb-2.5 text-xs font-bold uppercase tracking-wider text-content-secondary text-start">
                {t('commerce:subscriptions.thisWeek')}
            </RNText>
            <View className="flex-row gap-2.5">
                {week.map((day) => (
                    <View
                        key={day.date}
                        testID={`${testID}-${day.date}`}
                        className={cx(
                            'min-w-0 flex-1 flex-col gap-2 rounded-2xl p-2.5',
                            day.date === today ? 'bg-surface-brand-subtle' : 'bg-surface-base',
                        )}
                    >
                        <View className="flex-row items-baseline justify-between gap-1">
                            <RNText className="font-display text-sm font-bold text-content-primary">
                                {formatter.formatDate(day.date, { weekday: 'short' })}
                            </RNText>
                            <RNText className="text-xs font-medium text-content-secondary">
                                {formatter.formatDate(day.date, { day: 'numeric', month: 'short' })}
                            </RNText>
                        </View>
                        {day.meals.slice(0, 2).map((chosen) => {
                            const meal = menu.get(String(chosen.mealId));
                            return (
                                <View
                                    key={`${chosen.slot}-${String(chosen.sequence)}`}
                                    className="h-[58px] overflow-hidden rounded-xl bg-surface-sunken"
                                >
                                    {meal === undefined ? null : (
                                        <EntityImage
                                            assetId={meal.imagePlaceholderId}
                                            photoUrl={meal.photoUrl}
                                            seed={meal.slug}
                                            label={chosen.mealName}
                                            flush
                                            className="h-[58px] w-full"
                                        />
                                    )}
                                </View>
                            );
                        })}
                    </View>
                ))}
            </View>
        </View>
    );
}

function CardAction({
    testID,
    label,
    icon,
    tone = 'neutral',
    disabled = false,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly icon?: 'utensils' | undefined;
    readonly tone?: 'primary' | 'neutral';
    readonly disabled?: boolean;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            disabled={disabled}
            aria-disabled={disabled}
            accessibilityState={{ disabled }}
            onPress={onPress}
            className={cx(
                'h-12 flex-row items-center justify-center gap-2 rounded-[14px] border px-4',
                tone === 'primary'
                    ? 'grow border-surface-brand bg-surface-brand hover:opacity-90'
                    : 'border-stroke bg-surface-raised hover:bg-surface-brand-subtle',
                disabled ? 'opacity-50' : '',
            )}
        >
            {icon === undefined ? null : (
                <Icon
                    name={icon}
                    size="sm"
                    className={
                        tone === 'primary' ? 'text-content-on-brand' : 'text-content-primary'
                    }
                />
            )}
            <RNText
                className={cx(
                    'text-sm font-semibold',
                    tone === 'primary' ? 'text-content-on-brand' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}
