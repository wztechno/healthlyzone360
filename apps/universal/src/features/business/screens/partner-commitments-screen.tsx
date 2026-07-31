import {
    Badge,
    Button,
    Callout,
    Card,
    FilterChip,
    Heading,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { KitchenId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSupplyCommitmentsQuery } from '../../../data/business-hooks.ts';
import type { SupplyCommitment } from '../../../data/business-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { weekdayKey } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { catalogueKindKey, quotationStateKey } from '../format.ts';

/**
 * `/partner` — what a supplier has been asked to make, and for whom.
 *
 * ## A supplier sees quantities and dates, never the buyer's negotiated rate
 *
 * This is the deliberate half of the price-privacy rule that is easy to miss. The corporate screens
 * are the only ones that render a contract price, and "only" includes this one: the figures a
 * supplier needs to plan production are the quantity, the lead time and the delivery weekdays, none
 * of which is commercially sensitive to the buyer. Keeping the `contract-price-` marker to a single
 * area is what makes `e2e/specs/business-privacy.ltr.spec.ts` a meaningful assertion rather than a
 * list of exceptions. The screen says so in its own copy, so the omission reads as a decision rather
 * than as missing data.
 *
 * ## Commitments are derived from quotations, because that is what the contract publishes
 *
 * `BusinessRepository` has no supplier-side resource at all: no orders, no production schedule, no
 * fulfilment. What it does have is quotations, whose lines carry a catalogue item and a quantity,
 * and catalogue items, which carry the lead time and delivery weekdays. So a commitment here is
 * exactly that join, and nothing is invented on top of it. A real backend should publish
 * `GET /api/v1/partner/commitments`; the wave report records the gap.
 */

export function PartnerCommitmentsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const [kitchenId, setKitchenId] = useState<KitchenId | null>(null);

    const query = useSupplyCommitmentsQuery();
    const kitchens = useKitchensQuery({ limit: 12 });

    const commitments: readonly SupplyCommitment[] = (query.data ?? []).filter(
        (commitment) => kitchenId === null || commitment.item.kitchenId === kitchenId,
    );

    return (
        <Stack space="lg" testID="partner-commitments-screen">
            <Stack space="xs">
                <Heading level={1} testID="partner-commitments-title">
                    {t('business:partner.title')}
                </Heading>
                <Text tone="secondary">{t('business:partner.body')}</Text>
            </Stack>

            <Callout
                testID="partner-price-privacy"
                role="note"
                tone="info"
                icon="info"
                title={t('business:partner.privacyTitle')}
                body={t('business:partner.privacyBody')}
            />

            <Stack space="xs" testID="partner-kitchen-filter">
                <Text variant="label">{t('business:partner.kitchenFilter')}</Text>
                <Inline space="xs" wrap>
                    <FilterChip
                        testID="partner-kitchen-all"
                        label={t('business:partner.allKitchens')}
                        selected={kitchenId === null}
                        onChange={() => {
                            setKitchenId(null);
                        }}
                    />
                    {(kitchens.data?.items ?? []).map((kitchen) => (
                        <FilterChip
                            key={kitchen.id}
                            testID={`partner-kitchen-${String(kitchen.id)}`}
                            label={kitchen.name}
                            selected={kitchenId === kitchen.id}
                            onChange={(selected) => {
                                setKitchenId(selected ? kitchen.id : null);
                            }}
                        />
                    ))}
                </Inline>
            </Stack>

            <QueryStates
                query={query}
                isEmpty={commitments.length === 0}
                emptyTitle={t('business:partner.emptyTitle')}
                emptyBody={t('business:partner.emptyBody')}
                emptyActions={
                    kitchenId === null ? undefined : (
                        <Button
                            testID="partner-clear-kitchen"
                            variant="secondary"
                            label={t('business:partner.clearKitchen')}
                            onPress={() => {
                                setKitchenId(null);
                            }}
                        />
                    )
                }
                skeletonCount={2}
                testID="partner-commitments"
            >
                <Stack space="sm" testID="partner-commitment-list">
                    {commitments.map((commitment) => (
                        <Card
                            key={commitment.key}
                            testID={`partner-commitment-${commitment.key}`}
                            padding="md"
                        >
                            <Stack space="sm">
                                <Inline space="sm" align="center" justify="between">
                                    <Text variant="bodyStrong">{commitment.item.name}</Text>
                                    <Badge
                                        tone="info"
                                        icon="info"
                                        label={t(quotationStateKey(commitment.quotation.state))}
                                    />
                                </Inline>

                                <Text testID={`partner-commitment-${commitment.key}-quantity`}>
                                    {t('business:partner.quantity', {
                                        count: commitment.quantity,
                                    })}
                                </Text>

                                <Text
                                    tone="secondary"
                                    variant="caption"
                                    testID={`partner-commitment-${commitment.key}-reference`}
                                >
                                    {t('business:partner.reference', {
                                        reference: commitment.quotation.reference,
                                        date: formatter.formatDate(
                                            commitment.quotation.requestedAt,
                                            { dateStyle: 'medium' },
                                        ),
                                    })}
                                </Text>

                                <Text
                                    tone="secondary"
                                    variant="caption"
                                    testID={`partner-commitment-${commitment.key}-lead-time`}
                                >
                                    {t('business:catalogue.leadTime', {
                                        count: commitment.item.leadTimeDays,
                                    })}
                                </Text>

                                <Text
                                    tone="secondary"
                                    variant="caption"
                                    testID={`partner-commitment-${commitment.key}-weekdays`}
                                >
                                    {commitment.item.deliveryWeekdays.length === 0
                                        ? t('business:catalogue.noWeekdays')
                                        : t('business:catalogue.weekdays', {
                                              days: commitment.item.deliveryWeekdays
                                                  .map((weekday) => t(weekdayKey(weekday)))
                                                  .join(t('business:common.listSeparator')),
                                          })}
                                </Text>

                                <Inline space="xs" wrap>
                                    <Badge
                                        tone="neutral"
                                        icon="dot"
                                        label={t(catalogueKindKey(commitment.item.kind))}
                                    />
                                    {commitment.item.supportsRecurringOrder ? (
                                        <Badge
                                            tone="success"
                                            icon="check"
                                            label={t('business:catalogue.recurring')}
                                        />
                                    ) : null}
                                </Inline>
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            </QueryStates>

            <Text tone="secondary" variant="caption" testID="partner-source-note">
                {t('business:partner.sourceNote')}
            </Text>

            <Inline space="sm" wrap>
                <Button
                    testID="partner-open-schedule"
                    label={t('business:partner.openSchedule')}
                    onPress={() => {
                        router.push('/partner/schedule' as never);
                    }}
                />
            </Inline>
        </Stack>
    );
}
