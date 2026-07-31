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
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSubscriptionsQuery } from '../../../data/commerce-hooks.ts';
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
 * ## Every row says when the next delivery is
 *
 * Doc 17, `SUB-12` puts the remaining entitlement first on the detail screen; on a list, the fact
 * that decides whether somebody needs to act at all is the next delivery date. A paused
 * subscription says so instead of showing a date it will not honour.
 */

const FILTERS = ['all', 'live', 'paused', 'ended'] as const;
type FilterKey = (typeof FILTERS)[number];

const FILTER_STATES: Readonly<Record<FilterKey, readonly SubscriptionState[]>> = {
    all: [],
    live: ['active', 'skipped_today'],
    paused: ['paused'],
    ended: ['cancelled', 'expired'],
};

export function SubscriptionsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const [filter, setFilter] = useState<FilterKey>('all');
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
            <Stack space="xs">
                <Heading level={1} testID="subscriptions-title">
                    {t('commerce:subscriptions.title')}
                </Heading>
                <Text tone="secondary">{t('commerce:subscriptions.body')}</Text>
            </Stack>

            <SegmentedControl
                testID="subscriptions-filter"
                label={t('commerce:subscriptions.filterLabel')}
                block
                value={filter}
                onChange={(next) => {
                    setFilter(next as FilterKey);
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
                                setFilter('all');
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

                                <Text tone="secondary" variant="caption">
                                    {t('commerce:subscriptions.rowSummary', {
                                        price: formatMoney(formatter, subscription.weeklyPrice),
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

            <Text tone="secondary" variant="caption" testID="subscriptions-new-hint">
                {t('commerce:subscriptions.newHint')}
            </Text>
        </Stack>
    );
}
