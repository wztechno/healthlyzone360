import {
    Badge,
    Button,
    Card,
    Heading,
    Inline,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { CorporateProgramme, Quotation } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useCorporateCatalogueQuery,
    useCorporateProgrammesQuery,
    useQuotationsQuery,
} from '../../../data/business-hooks.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { contractPriceTestId, quotationStateKey } from '../format.ts';

/**
 * `/corporate` — the programmes this account buys through, and what is outstanding on each.
 *
 * ## The programme list is a contract gap, and the screen says so
 *
 * `BusinessRepository` has `listCorporateProgrammes()` and `getCorporateProgramme(programmeId)`.
 * The list below is the organisation's buyer programmes from the API (or mock store).
 *
 * ## Prices are allowed here, and only here
 *
 * This is a corporate surface, so it may render negotiated figures — the per-employee subsidy is
 * one. Every such figure carries the `contract-price-` marker so the privacy sweep can prove none of
 * them reaches a consumer route (`../format.ts`).
 *
 * ## Counts, not totals
 *
 * The dashboard spans programmes, and programmes are not guaranteed to share a currency — one
 * fixture line is priced in SAR precisely to make that concrete. So this screen reports headcounts,
 * line counts and tier counts, and leaves money to the single-programme screens where a currency is
 * actually established.
 */
export function CorporateDashboardScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const [code, setCode] = useState('');

    const programmes = useCorporateProgrammesQuery();
    const visible: readonly CorporateProgramme[] = programmes.data ?? [];
    const quotations = useQuotationsQuery();
    const outstanding: readonly Quotation[] = quotations.data?.items ?? [];

    return (
        <Stack space="lg" testID="corporate-dashboard-screen">
            <Stack space="xs">
                <Heading level={1} testID="corporate-dashboard-title">
                    {t('business:dashboard.title')}
                </Heading>
                <Text tone="secondary">{t('business:dashboard.body')}</Text>
            </Stack>

            <Text tone="secondary" variant="caption" testID="corporate-programme-source">
                {t('business:dashboard.sourceNote')}
            </Text>

            <QueryStates
                query={programmes}
                isEmpty={visible.length === 0}
                emptyTitle={t('business:dashboard.emptyTitle')}
                emptyBody={t('business:dashboard.emptyBody')}
                skeletonCount={2}
                testID="corporate-programmes"
            >
                <Stack space="sm" testID="corporate-programme-list">
                    {visible.map((programme) => (
                        <ProgrammeCard key={programme.id} programme={programme} />
                    ))}
                </Stack>
            </QueryStates>

            <Stack space="sm" testID="corporate-lookup">
                <Text variant="label">{t('business:dashboard.lookupTitle')}</Text>
                <TextInputField
                    testID="corporate-lookup-code"
                    id="corporate-lookup-code"
                    label={t('business:dashboard.lookupLabel')}
                    hint={t('business:dashboard.lookupHint')}
                    value={code}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setCode}
                />
                <Inline space="sm" wrap>
                    <Button
                        testID="corporate-lookup-open"
                        variant="secondary"
                        label={t('business:dashboard.lookupOpen')}
                        disabled={code.trim() === ''}
                        onPress={() => {
                            router.push(`/corporate/items/${code.trim()}` as never);
                        }}
                    />
                </Inline>
            </Stack>

            <Stack space="sm" testID="corporate-quotation-summary">
                <Text variant="label">{t('business:dashboard.quotationsTitle')}</Text>
                <QueryStates
                    query={quotations}
                    isEmpty={outstanding.length === 0}
                    emptyTitle={t('business:dashboard.noQuotationsTitle')}
                    emptyBody={t('business:dashboard.noQuotationsBody')}
                    skeletonCount={1}
                    testID="corporate-quotations"
                >
                    <Stack space="xs">
                        {outstanding.map((quotation) => (
                            <Inline
                                key={quotation.id}
                                space="sm"
                                align="center"
                                wrap
                                testID={`corporate-quotation-${quotation.reference}`}
                            >
                                <Badge
                                    tone={quotation.state === 'quoted' ? 'success' : 'info'}
                                    icon="info"
                                    label={t(quotationStateKey(quotation.state))}
                                />
                                <Text>{quotation.reference}</Text>
                                <Text tone="secondary" variant="caption">
                                    {t('business:dashboard.quotationLines', {
                                        count: quotation.lines.length,
                                    })}
                                </Text>
                            </Inline>
                        ))}
                    </Stack>
                </QueryStates>
                <Inline space="sm" wrap>
                    <Button
                        testID="corporate-open-quotations"
                        variant="secondary"
                        label={t('business:dashboard.openQuotations')}
                        onPress={() => {
                            router.push('/corporate/quotations' as never);
                        }}
                    />
                </Inline>
            </Stack>
        </Stack>
    );
}

interface ProgrammeCardProps {
    readonly programme: CorporateProgramme;
}

/**
 * One programme.
 *
 * The catalogue is read per card rather than once for the screen because `listCatalogue` is scoped
 * to a programme by the contract — there is no "everything I can buy" call — and the two figures a
 * buyer actually opens this page for are how many lines are negotiated and how many volume tiers are
 * live across them.
 */
function ProgrammeCard({ programme }: ProgrammeCardProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const catalogue = useCorporateCatalogueQuery({ programmeId: programme.id });
    const items = catalogue.data?.items ?? [];
    const tierCount = items.reduce((running, item) => running + item.volumeTiers.length, 0);

    const testId = `corporate-programme-${String(programme.id)}`;

    return (
        <Card testID={testId} padding="md">
            <Stack space="sm">
                <Inline space="sm" align="center" justify="between">
                    <Text variant="bodyStrong" testID={`${testId}-name`}>
                        {programme.name}
                    </Text>
                    <Badge
                        testID={`${testId}-state`}
                        tone={programme.isActive ? 'success' : 'neutral'}
                        icon={programme.isActive ? 'check' : 'dot'}
                        label={
                            programme.isActive
                                ? t('business:programme.active')
                                : t('business:programme.inactive')
                        }
                    />
                </Inline>

                <Text tone="secondary">{programme.summary}</Text>

                <Text testID={`${testId}-headcount`}>
                    {t('business:programme.headcount', { count: programme.headcount })}
                </Text>

                <Text testID={`${testId}-locations`} tone="secondary" variant="caption">
                    {t('business:programme.locations', {
                        locations: programme.deliveryLocations.join(
                            t('business:common.listSeparator'),
                        ),
                    })}
                </Text>

                {programme.employeeSubsidy === null ? (
                    <Text testID={`${testId}-no-subsidy`} tone="secondary" variant="caption">
                        {t('business:programme.noSubsidy')}
                    </Text>
                ) : (
                    <Text testID={contractPriceTestId(`subsidy-${String(programme.id)}`)}>
                        {t('business:programme.subsidy', {
                            amount: formatMoney(formatter, programme.employeeSubsidy),
                        })}
                    </Text>
                )}

                <Text testID={`${testId}-term`} tone="secondary" variant="caption">
                    {programme.endsAt === null
                        ? t('business:programme.termOpen', {
                              start: formatter.formatDate(programme.startsAt, {
                                  dateStyle: 'medium',
                              }),
                          })
                        : t('business:programme.term', {
                              start: formatter.formatDate(programme.startsAt, {
                                  dateStyle: 'medium',
                              }),
                              end: formatter.formatDate(programme.endsAt, { dateStyle: 'medium' }),
                          })}
                </Text>

                <Text testID={`${testId}-manager`} tone="secondary" variant="caption">
                    {programme.accountManagerName === null
                        ? t('business:programme.noManager')
                        : t('business:programme.manager', {
                              name: programme.accountManagerName,
                          })}
                </Text>

                <Text testID={`${testId}-tiers`} tone="secondary" variant="caption">
                    {catalogue.isPending
                        ? t('business:programme.tiersLoading')
                        : t('business:programme.tiers', {
                              lines: items.length,
                              tiers: tierCount,
                          })}
                </Text>

                <Inline space="sm" wrap>
                    <Button
                        testID={`${testId}-open-catalogue`}
                        size="sm"
                        label={t('business:programme.openCatalogue')}
                        onPress={() => {
                            router.push(`/corporate/catalogue/${String(programme.id)}` as never);
                        }}
                    />
                    <Button
                        testID={`${testId}-request-quotation`}
                        size="sm"
                        variant="secondary"
                        label={t('business:programme.requestQuotation')}
                        onPress={() => {
                            router.push(
                                `/corporate/quotations/new?programme=${String(programme.id)}` as never,
                            );
                        }}
                    />
                </Inline>
            </Stack>
        </Card>
    );
}
