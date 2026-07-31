import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Icon,
    Inline,
    SegmentedControl,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { CATALOGUE_ITEM_KINDS } from '@healthy360/api-client/contracts';
import type {
    CatalogueFilter,
    CatalogueItem,
    CatalogueItemKind,
} from '@healthy360/api-client/contracts';
import { CorporateProgrammeId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useCorporateCatalogueQuery,
    useCorporateProgrammeQuery,
} from '../../../data/business-hooks.ts';
import { formatMoney, weekdayKey } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { catalogueKindKey, contractPriceTestId, salesChannelKey } from '../format.ts';

/**
 * `/corporate/catalogue/{programme}` — the negotiated lines for one programme, priced.
 *
 * ## This is one of the two screens allowed to show a contract price
 *
 * Every figure here carries the `contract-price-` marker (`../format.ts`), which is what
 * `e2e/specs/business-privacy.ltr.spec.ts` proves never reaches a marketplace or customer route. The
 * marker is meaningful in both directions: the sweep asserts its absence over there *and* its
 * presence here, because a marker nobody applies proves nothing.
 *
 * ## The catalogue is scoped to a programme because the contract scopes it
 *
 * `CatalogueFilter` requires a `programmeId`. There is no cross-programme listing and this screen
 * does not simulate one — a negotiated catalogue is paperwork between one buyer and this business,
 * and merging two of them would show a buyer a rate they are not party to.
 *
 * ## The currency line is the multi-currency proof
 *
 * One fixture line is priced in SAR while the rest are AED. When a programme's lines span more than
 * one currency the screen says so and offers no total at all, rather than adding riyals to dirhams
 * behind a plausible-looking number.
 */

export interface CorporateCatalogueScreenProps {
    readonly programmeId: string | undefined;
}

const KIND_FILTERS = ['all', ...CATALOGUE_ITEM_KINDS] as const;
type KindFilter = (typeof KIND_FILTERS)[number];

export function CorporateCatalogueScreen({ programmeId }: CorporateCatalogueScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const parsed = programmeId === undefined ? null : CorporateProgrammeId.safeParse(programmeId);

    const [query, setQuery] = useState('');
    const [kind, setKind] = useState<KindFilter>('all');

    const programme = useCorporateProgrammeQuery(parsed);

    const filter: CatalogueFilter | null =
        parsed === null
            ? null
            : {
                  programmeId: parsed,
                  ...(query.trim() === '' ? {} : { query: query.trim() }),
                  ...(kind === 'all' ? {} : { kinds: [kind as CatalogueItemKind] }),
              };

    const catalogue = useCorporateCatalogueQuery(filter);
    const items: readonly CatalogueItem[] = catalogue.data?.items ?? [];

    const currencies = [
        ...new Set(
            items
                .map((item) => item.contractPrice?.currency)
                .filter((code): code is NonNullable<typeof code> => code !== undefined),
        ),
    ];

    const backAction = (
        <Button
            testID="corporate-catalogue-back"
            variant="secondary"
            label={t('business:catalogue.back')}
            onPress={() => {
                router.push('/corporate' as never);
            }}
        />
    );

    if (parsed === null) {
        return (
            <Stack space="lg" testID="corporate-catalogue-screen">
                <Callout
                    testID="corporate-catalogue-not-found"
                    role="alert"
                    tone="warning"
                    icon="warning"
                    title={t('business:catalogue.notFoundTitle')}
                    body={t('business:catalogue.notFoundBody')}
                    actions={backAction}
                />
            </Stack>
        );
    }

    return (
        <Stack space="lg" testID="corporate-catalogue-screen">
            <Stack space="xs">
                <Heading level={1} testID="corporate-catalogue-title">
                    {t('business:catalogue.title')}
                </Heading>
                <Text tone="secondary" testID="corporate-catalogue-programme">
                    {programme.data === undefined
                        ? t('business:catalogue.programmeLoading')
                        : programme.data.name}
                </Text>
            </Stack>

            <Callout
                testID="corporate-catalogue-privacy"
                role="note"
                tone="info"
                icon="info"
                title={t('business:catalogue.privacyTitle')}
                body={t('business:catalogue.privacyBody')}
            />

            <TextInputField
                testID="corporate-catalogue-search"
                id="corporate-catalogue-search"
                label={t('business:catalogue.searchLabel')}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                trailing={<Icon name="search" />}
            />

            <SegmentedControl
                testID="corporate-catalogue-kind"
                label={t('business:catalogue.kindLabel')}
                block
                value={kind}
                onChange={(next) => {
                    setKind(next as KindFilter);
                }}
                items={KIND_FILTERS.map((value) => ({
                    value,
                    label:
                        value === 'all'
                            ? t('business:catalogue.kindAll')
                            : t(catalogueKindKey(value)),
                    testID: `corporate-catalogue-kind-${value}`,
                }))}
            />

            <Text tone="secondary" variant="caption" testID="corporate-catalogue-currencies">
                {currencies.length > 1
                    ? t('business:catalogue.mixedCurrency', {
                          currencies: currencies.join(t('business:common.listSeparator')),
                      })
                    : t('business:catalogue.singleCurrency', {
                          currency: currencies[0] ?? t('business:catalogue.noCurrency'),
                      })}
            </Text>

            <QueryStates
                query={catalogue}
                isEmpty={items.length === 0}
                emptyTitle={t('business:catalogue.emptyTitle')}
                emptyBody={t('business:catalogue.emptyBody')}
                emptyActions={
                    <Button
                        testID="corporate-catalogue-clear"
                        variant="secondary"
                        label={t('business:catalogue.clearFilters')}
                        onPress={() => {
                            setQuery('');
                            setKind('all');
                        }}
                    />
                }
                skeletonCount={3}
                testID="corporate-catalogue"
            >
                <Stack space="sm" testID="corporate-catalogue-list">
                    {items.map((item) => (
                        <Card key={item.id} testID={`catalogue-item-${item.id}`} padding="md">
                            <Stack space="sm">
                                <Inline space="sm" align="center" justify="between">
                                    <Text
                                        variant="bodyStrong"
                                        testID={`catalogue-item-${item.id}-name`}
                                    >
                                        {item.name}
                                    </Text>
                                    <Badge
                                        testID={`catalogue-item-${item.id}-kind`}
                                        tone="info"
                                        icon="info"
                                        label={t(catalogueKindKey(item.kind))}
                                    />
                                </Inline>

                                <Text tone="secondary">{item.description}</Text>

                                {item.contractPrice === null ? (
                                    <Text
                                        testID={`catalogue-item-${item.id}-unpriced`}
                                        tone="secondary"
                                    >
                                        {t('business:catalogue.unpriced')}
                                    </Text>
                                ) : (
                                    <Text testID={contractPriceTestId(item.id)}>
                                        {t('business:catalogue.contractPrice', {
                                            price: formatMoney(formatter, item.contractPrice),
                                        })}
                                    </Text>
                                )}

                                <Text
                                    testID={`catalogue-item-${item.id}-minimum`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {t('business:catalogue.minimum', {
                                        count: item.minimumOrderQuantity,
                                    })}
                                </Text>

                                <Text
                                    testID={`catalogue-item-${item.id}-lead-time`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {t('business:catalogue.leadTime', { count: item.leadTimeDays })}
                                </Text>

                                <Text
                                    testID={`catalogue-item-${item.id}-weekdays`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {item.deliveryWeekdays.length === 0
                                        ? t('business:catalogue.noWeekdays')
                                        : t('business:catalogue.weekdays', {
                                              days: item.deliveryWeekdays
                                                  .map((weekday) => t(weekdayKey(weekday)))
                                                  .join(t('business:common.listSeparator')),
                                          })}
                                </Text>

                                <Inline
                                    space="xs"
                                    wrap
                                    testID={`catalogue-item-${item.id}-channels`}
                                >
                                    {item.channels.map((channel) => (
                                        <Badge
                                            key={channel}
                                            tone="neutral"
                                            icon="dot"
                                            label={t(salesChannelKey(channel))}
                                        />
                                    ))}
                                    {item.supportsRecurringOrder ? (
                                        <Badge
                                            testID={`catalogue-item-${item.id}-recurring`}
                                            tone="success"
                                            icon="check"
                                            label={t('business:catalogue.recurring')}
                                        />
                                    ) : null}
                                </Inline>

                                <Inline space="sm" wrap>
                                    <Button
                                        testID={`catalogue-item-${item.id}-open`}
                                        size="sm"
                                        variant="secondary"
                                        label={t('business:catalogue.open')}
                                        onPress={() => {
                                            router.push(`/corporate/items/${item.id}` as never);
                                        }}
                                    />
                                    <Button
                                        testID={`catalogue-item-${item.id}-quote`}
                                        size="sm"
                                        label={t('business:catalogue.quote')}
                                        onPress={() => {
                                            router.push(
                                                `/corporate/quotations/new?programme=${String(parsed)}&item=${item.id}` as never,
                                            );
                                        }}
                                    />
                                </Inline>
                            </Stack>
                        </Card>
                    ))}
                </Stack>
            </QueryStates>

            <Inline space="sm" wrap>
                {backAction}
                <Button
                    testID="corporate-catalogue-build-quotation"
                    label={t('business:catalogue.buildQuotation')}
                    onPress={() => {
                        router.push(
                            `/corporate/quotations/new?programme=${String(parsed)}` as never,
                        );
                    }}
                />
            </Inline>
        </Stack>
    );
}
