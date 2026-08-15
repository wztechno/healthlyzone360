import {
    Badge,
    Button,
    Card,
    Heading,
    Inline,
    SegmentedControl,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { Quotation, QuotationFilter, QuotationState } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useAcceptQuotationMutation,
    useDeclineQuotationMutation,
    useQuotationsQuery,
} from '../../../data/business-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { contractPriceTestId, quotationStateKey } from '../format.ts';

/**
 * `/corporate/quotations` — every quotation this account has raised.
 *
 * ## A submitted quotation carries no price, and the screen shows that rather than hiding it
 *
 * `QuotationLine.quotedUnitPrice` is `null` until an account manager has priced the line
 * (`contracts/business.ts`). A submitted request therefore renders "awaiting a price" against every
 * line, and a `quoted` one renders the figures. That distinction is the whole state machine made
 * visible: the prototype never invents a total for something nobody has priced.
 *
 * ## Accept and decline are real; PDF export is not offered
 *
 * `acceptQuotation` / `declineQuotation` hit `POST /b2b/quotations/{id}/accept|decline`. There is no
 * document endpoint, so `quotationExport` is unavailable (`src/features/availability.ts`) and the
 * download control is absent — a button that could only ever explain its own absence is worse than
 * no button.
 */

const FILTERS = ['all', 'open', 'quoted', 'closed'] as const;
type FilterKey = (typeof FILTERS)[number];

const FILTER_STATES: Readonly<Record<FilterKey, readonly QuotationState[]>> = {
    all: [],
    open: ['draft', 'submitted', 'in_review'],
    quoted: ['quoted'],
    closed: ['accepted', 'declined', 'expired'],
};

export function QuotationsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const [filter, setFilter] = useState<FilterKey>('all');
    const states = FILTER_STATES[filter];
    const request: QuotationFilter = states.length === 0 ? {} : { states };

    const quotations = useQuotationsQuery(request);
    const accept = useAcceptQuotationMutation();
    const decline = useDeclineQuotationMutation();
    const items: readonly Quotation[] = quotations.data?.items ?? [];
    const deciding = accept.isPending || decline.isPending;

    return (
        <Stack space="lg" testID="quotations-screen">
            <Stack space="xs">
                <Heading level={1} testID="quotations-title">
                    {t('business:quotations.title')}
                </Heading>
                <Text tone="secondary">{t('business:quotations.body')}</Text>
            </Stack>

            <SegmentedControl
                testID="quotations-filter"
                label={t('business:quotations.filterLabel')}
                block
                value={filter}
                onChange={(next) => {
                    setFilter(next as FilterKey);
                }}
                items={FILTERS.map((key) => ({
                    value: key,
                    label: t(`business:quotations.filters.${key}`),
                    testID: `quotations-filter-${key}`,
                }))}
            />

            <QueryStates
                query={quotations}
                isEmpty={items.length === 0}
                emptyTitle={
                    filter === 'all'
                        ? t('business:quotations.emptyTitle')
                        : t('business:quotations.emptyFilteredTitle')
                }
                emptyBody={
                    filter === 'all'
                        ? t('business:quotations.emptyBody')
                        : t('business:quotations.emptyFilteredBody')
                }
                emptyActions={
                    filter === 'all' ? (
                        <Button
                            testID="quotations-corporate-home"
                            label={t('business:quotations.home')}
                            onPress={() => {
                                router.push('/corporate' as never);
                            }}
                        />
                    ) : (
                        <Button
                            testID="quotations-clear-filter"
                            variant="secondary"
                            label={t('business:quotations.clearFilter')}
                            onPress={() => {
                                setFilter('all');
                            }}
                        />
                    )
                }
                skeletonCount={2}
                testID="quotations"
            >
                <Stack space="sm" testID="quotations-list">
                    {items.map((quotation) => {
                        const testId = `quotation-${quotation.reference}`;
                        return (
                            <Card key={quotation.id} testID={testId} padding="md">
                                <Stack space="sm">
                                    <Inline space="sm" align="center" justify="between">
                                        <Text variant="bodyStrong" testID={`${testId}-reference`}>
                                            {quotation.reference}
                                        </Text>
                                        <Badge
                                            testID={`${testId}-state`}
                                            tone={
                                                quotation.state === 'quoted'
                                                    ? 'success'
                                                    : quotation.state === 'declined' ||
                                                        quotation.state === 'expired'
                                                      ? 'neutral'
                                                      : 'info'
                                            }
                                            icon="info"
                                            label={t(quotationStateKey(quotation.state))}
                                        />
                                    </Inline>

                                    <Text
                                        tone="secondary"
                                        variant="caption"
                                        testID={`${testId}-raised`}
                                    >
                                        {t('business:quotations.raised', {
                                            date: formatter.formatDate(quotation.requestedAt, {
                                                dateStyle: 'medium',
                                            }),
                                        })}
                                    </Text>

                                    <Stack space="xs" testID={`${testId}-lines`}>
                                        {quotation.lines.map((line) => (
                                            <Stack key={line.catalogueItemId} space="xs">
                                                <Text>
                                                    {t('business:quotations.line', {
                                                        name: line.name,
                                                        count: line.quantity,
                                                    })}
                                                </Text>
                                                {line.quotedTotal === null ? (
                                                    <Text
                                                        testID={`${testId}-line-${line.catalogueItemId}-unpriced`}
                                                        tone="secondary"
                                                        variant="caption"
                                                    >
                                                        {t('business:quotations.awaitingPrice')}
                                                    </Text>
                                                ) : (
                                                    <Text
                                                        testID={contractPriceTestId(
                                                            `quoted-${quotation.reference}-${line.catalogueItemId}`,
                                                        )}
                                                        variant="caption"
                                                    >
                                                        {t('business:quotations.linePriced', {
                                                            total: formatMoney(
                                                                formatter,
                                                                line.quotedTotal,
                                                            ),
                                                        })}
                                                    </Text>
                                                )}
                                            </Stack>
                                        ))}
                                    </Stack>

                                    {quotation.requestedTotal === null ? null : (
                                        <Text
                                            testID={contractPriceTestId(
                                                `quoted-total-${quotation.reference}`,
                                            )}
                                        >
                                            {t('business:quotations.total', {
                                                total: formatMoney(
                                                    formatter,
                                                    quotation.requestedTotal,
                                                ),
                                            })}
                                        </Text>
                                    )}

                                    {quotation.expiresAt === null ? null : (
                                        <Text
                                            tone="secondary"
                                            variant="caption"
                                            testID={`${testId}-expires`}
                                        >
                                            {t('business:quotations.expires', {
                                                date: formatter.formatDate(quotation.expiresAt, {
                                                    dateStyle: 'medium',
                                                }),
                                            })}
                                        </Text>
                                    )}

                                    <Inline space="xs" wrap>
                                        <Badge
                                            testID={`${testId}-recurring`}
                                            tone={quotation.recurring ? 'success' : 'neutral'}
                                            icon={quotation.recurring ? 'check' : 'dot'}
                                            label={
                                                quotation.recurring
                                                    ? t('business:quotations.recurring')
                                                    : t('business:quotations.oneOff')
                                            }
                                        />
                                    </Inline>

                                    {quotation.note === null ? null : (
                                        <Text
                                            tone="secondary"
                                            variant="caption"
                                            testID={`${testId}-note`}
                                        >
                                            {quotation.note}
                                        </Text>
                                    )}

                                    <Inline space="sm" wrap>
                                        {quotation.state === 'quoted' ? (
                                            <>
                                                <Button
                                                    testID={`${testId}-accept`}
                                                    label={t('business:quotations.accept')}
                                                    disabled={deciding}
                                                    onPress={() => {
                                                        accept.mutate(quotation.id);
                                                    }}
                                                />
                                                <Button
                                                    testID={`${testId}-decline`}
                                                    variant="secondary"
                                                    label={t('business:quotations.decline')}
                                                    disabled={deciding}
                                                    onPress={() => {
                                                        decline.mutate({
                                                            quotationId: quotation.id,
                                                        });
                                                    }}
                                                />
                                            </>
                                        ) : null}
                                    </Inline>
                                </Stack>
                            </Card>
                        );
                    })}
                </Stack>
            </QueryStates>

            <Inline space="sm" wrap>
                <Button
                    testID="quotations-back"
                    variant="quiet"
                    label={t('business:quotations.back')}
                    onPress={() => {
                        router.push('/corporate' as never);
                    }}
                />
            </Inline>
        </Stack>
    );
}
