import {
    Button,
    Card,
    Heading,
    Inline,
    SegmentedControl,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { Subscription, SubscriptionFilter } from '@healthy360/api-client/contracts';
import type { SubscriptionState } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useSubscriptionsQuery } from '../../../data/commerce-hooks.ts';
import { subscriptionDayPrice } from '../../catalogue/plan-balance.ts';
import { formatMoney, weekdayKey } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { SubscriptionStateBadge } from '../state-badge.tsx';

/**
 * `/customer/subscriptions` — every subscription this person has.
 *
 * ## The filter is over states, not over a search box
 *
 * A person has a handful of subscriptions, not hundreds, so a text search would be a control with
 * nothing to do. What they do have is a *lifecycle* — live, paused, finished — and the useful
 * question is "which of these is still delivering?". The four groups map onto `SUBSCRIPTION_STATES`
 * exactly, and `skipped_today` sits with `active` because a subscription that skipped today is
 * still a live subscription, which is the whole reason it is a separate state rather than a flag.
 *
 * ## Every row says what is left of the balance
 *
 * S1 made a subscription a consumable balance of delivery days, and "how many have I got left?" is
 * the question a list of them is opened to answer. It is on `Subscription` itself rather than behind
 * `getSubscriptionBalance`, so the list costs one request rather than one per row.
 *
 * ## Every row says when the next delivery is
 *
 * Doc 17, `SUB-12` puts the remaining entitlement first on the detail screen; on a list, the fact
 * that decides whether somebody needs to act at all is the next delivery date. A paused
 * subscription says so instead of showing a date it will not honour.
 *
 * ## The filter is in the URL
 *
 * `?status=` on whatever page draws the list — the account's subscriptions section — written with
 * `setParams`, so opening a subscription and coming Back, or a refresh, finds the group the person
 * chose rather than "All" again (plans-08). Never `?state=`: React Navigation reads `state` (with
 * `screen`, `params`, `initial`, `merge` and `pop`) as an instruction for a nested navigator.
 *
 * ## Another plan is one press away
 *
 * The list ends in "Browse meal plans", the action itself, where it used to end in a sentence naming
 * a button this page does not have (plans-14).
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

export interface SubscriptionsScreenProps {
    /**
     * Drawn as a section of the account page rather than as a page of its own: the account's side
     * nav already names it, so the page heading is dropped.
     */
    readonly embedded?: boolean | undefined;
}

export function SubscriptionsScreen({ embedded = false }: SubscriptionsScreenProps = {}) {
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

    const browseAction = (
        <Button
            testID="subscriptions-browse"
            label={t('commerce:subscriptions.browse')}
            onPress={() => {
                router.push('/plans');
            }}
        />
    );

    return (
        <Stack space="lg" testID="subscriptions-screen">
            {embedded ? null : (
                <Stack space="xs">
                    <Heading level={1} testID="subscriptions-title">
                        {t('commerce:subscriptions.title')}
                    </Heading>
                    <Text tone="secondary">{t('commerce:subscriptions.body')}</Text>
                </Stack>
            )}

            <SegmentedControl
                testID="subscriptions-filter"
                label={t('commerce:subscriptions.filterLabel')}
                block
                value={filter}
                onChange={(next) => {
                    if (isFilterKey(next)) chooseFilter(next);
                }}
                items={FILTERS.map((key) => ({
                    value: key,
                    label: t(`commerce:subscriptions.filters.${key}`),
                    testID: `subscriptions-filter-${key}`,
                }))}
            />

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
                        browseAction
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
                skeletonCount={2}
                testID="subscriptions"
            >
                <Stack space="sm" testID="subscriptions-list">
                    {items.map((subscription) => (
                        <Card
                            key={subscription.id}
                            testID={`subscription-row-${String(subscription.id)}`}
                            padding="md"
                        >
                            <Stack space="sm">
                                <Inline space="sm" align="center" justify="between">
                                    <Text variant="bodyStrong">{subscription.planName}</Text>
                                    <SubscriptionStateBadge
                                        state={subscription.state}
                                        testID={`subscription-row-${String(subscription.id)}-state`}
                                    />
                                </Inline>

                                <Text
                                    testID={`subscription-row-${String(subscription.id)}-next`}
                                    tone="secondary"
                                >
                                    {subscription.nextDeliveryDate === null
                                        ? t('commerce:subscriptions.noNextDelivery')
                                        : t('commerce:subscriptions.nextDelivery', {
                                              date: formatter.formatDate(
                                                  subscription.nextDeliveryDate,
                                                  { dateStyle: 'full' },
                                              ),
                                          })}
                                </Text>

                                {/*
                                 * The balance, on the list.
                                 *
                                 * `Subscription` carries `days` because the backend's own presenter
                                 * does — so a list of five subscriptions says "6 of 20 days left"
                                 * five times without five extra requests. A row that had to fetch
                                 * its own balance would be the N+1 this field exists to prevent.
                                 */}
                                <Text
                                    testID={`subscription-row-${String(subscription.id)}-balance`}
                                    variant="bodyStrong"
                                >
                                    {t('commerce:balance.remaining', {
                                        count: subscription.days.remaining,
                                    })}
                                </Text>

                                <Text tone="secondary" variant="caption">
                                    {t('commerce:subscriptions.rowSummary', {
                                        price: formatMoney(
                                            formatter,
                                            subscriptionDayPrice(subscription),
                                        ),
                                        days: subscription.configuration.deliveryWeekdays
                                            .map((weekday) => t(weekdayKey(weekday)))
                                            .join(t('commerce:common.listSeparator')),
                                    })}
                                </Text>

                                <Inline space="sm" wrap>
                                    <Button
                                        testID={`subscription-row-${String(subscription.id)}-open`}
                                        size="sm"
                                        label={t('commerce:subscriptions.open')}
                                        onPress={() => {
                                            router.push(
                                                `/customer/subscriptions/${String(subscription.id)}` as never,
                                            );
                                        }}
                                    />
                                </Inline>
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            </QueryStates>

            {/* The empty state already carries it; under a list it is the way to another plan. */}
            {items.length === 0 ? null : (
                <View className="self-start">
                    <Button
                        testID="subscriptions-browse"
                        variant="secondary"
                        label={t('commerce:subscriptions.browse')}
                        onPress={() => {
                            router.push('/plans');
                        }}
                    />
                </View>
            )}
        </Stack>
    );
}
