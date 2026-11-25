import { Button, Cascade, cx, EmptyState, ErrorState, Heading, Icon, Inline, SearchInput, Skeleton, Stack, Text, useContentWidth, useToast } from '@healthy360/design-system';
import type { CorporateProgramme, Quotation } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import {
    toFailure,
    useCorporateCatalogueQuery,
    useCorporateProgrammesQuery,
    useQuotationsQuery,
} from '../../../data/business-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { DeskChip } from '../../kitchen-admin/desk-kit/desk-chip.tsx';
import { CountPill, Panel, StatTile } from '../../kitchen-admin/hub-parts.tsx';
import { compareText } from '../../kitchen-admin/catalogue/use-column-controls.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { AcceptQuotationDialog, DeclineQuotationDialog } from '../accept-quotation-dialog.tsx';
import {
    CORPORATE_NEW_QUOTATION_HREF,
    CORPORATE_QUOTATIONS_HREF,
    corporateCatalogueHref,
} from '../corporate-chrome.tsx';
import { contractPriceTestId, quotationStateKey, quotationTone } from '../format.ts';

/**
 * `/corporate` — the buyer's overview, from the corporate canvas's Overview board (2026-11-10):
 *
 * 1. **The opening:** today and the company, the title, and New quotation.
 * 2. **Four figures**, as the kitchen's overview draws them: what is waiting on you (amber when it
 *    is not zero), open quotations, accepted ones and the programmes running. Each opens its list.
 * 3. **Two columns.** Start: *Waiting on you* — the priced quotations, with Accept and Decline right
 *    there, and the ones still with the account manager — then the latest quotations. End: each
 *    programme, then *Open a line by its code*.
 *
 * Counts, not totals: the overview spans programmes, which need not share a currency. Money appears
 * per quotation only, with the `contract-price-` marker (`../format.ts`).
 */

/** How many quotations the Latest card lists before "See all". */
const RECENT_QUOTATIONS = 4;

const isOpen = (row: Quotation) =>
    row.state === 'draft' || row.state === 'submitted' || row.state === 'in_review';

export function CorporateDashboardScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const toast = useToast();
    const { me } = useSession();
    const { width: contentWidth } = useContentWidth();
    const wide = contentWidth >= 900;

    const programmes = useCorporateProgrammesQuery();
    const programmeList = useMemo<readonly CorporateProgramme[]>(
        () => programmes.data ?? [],
        [programmes.data],
    );
    const quotations = useQuotationsQuery();
    const all: readonly Quotation[] = quotations.data?.items ?? [];

    const [deciding, setDeciding] = useState<{
        readonly quotation: Quotation;
        readonly kind: 'accept' | 'decline';
    } | null>(null);

    const organisationId = me?.activeContext?.organisationId ?? null;
    const organisation = me?.memberships.find(
        (membership) => membership.organisation.id === organisationId,
    )?.organisation.name;
    const todayDate = formatter.formatDate(new Date(), { dateStyle: 'full' });
    const dateLine =
        organisation === undefined
            ? todayDate
            : t('business:overview.dateLine', { date: todayDate, organisation });

    const awaiting = all.filter((row) => row.state === 'quoted');
    const submitted = all.filter((row) => row.state === 'submitted' || row.state === 'in_review');
    const open = all.filter(isOpen).length;
    const accepted = all.filter((row) => row.state === 'accepted').length;
    const running = programmeList.filter((programme) => programme.isActive).length;
    const recent = [...all]
        .sort((left, right) => compareText(left.requestedAt, right.requestedAt, 'desc'))
        .slice(0, RECENT_QUOTATIONS);

    const go = (href: string) => () => {
        router.push(href as never);
    };
    const view = (row: Quotation) =>
        go(`${CORPORATE_QUOTATIONS_HREF}?open=${encodeURIComponent(row.reference)}`);
    const programmeOf = (row: Quotation) =>
        programmeList.find((programme) => programme.id === row.programmeId);
    const linesText = (row: Quotation) => t('business:overview.lines', { count: row.lines.length });

    const programmesFailure = toFailure(programmes.error);
    const quotationsFailure = toFailure(quotations.error);
    const first = programmeList[0];

    return (
        <Cascade space="md" testID="corporate-dashboard-screen">
            <Inline space="sm" align="end" justify="between" wrap>
                <Stack space="xs" className="min-w-0">
                    <Text tone="secondary" testID="corporate-dashboard-date">
                        {dateLine}
                    </Text>
                    <Heading level={1} className="!text-3xl" testID="corporate-dashboard-title">
                        {t('business:overview.title')}
                    </Heading>
                </Stack>
                <Button
                    testID="corporate-dashboard-new-quotation"
                    variant="secondary"
                    size="lg"
                    iconStart={<Icon name="plus" size="md" className="text-content-primary" />}
                    label={t('business:nav.newQuotation')}
                    onPress={go(CORPORATE_NEW_QUOTATION_HREF)}
                />
            </Inline>

            <View testID="corporate-dashboard-stats" className="flex-row flex-wrap gap-3">
                <StatTile
                    testID="corporate-dashboard-stats-awaiting"
                    label={t('business:overview.kpiAwaiting')}
                    value={formatter.formatNumber(awaiting.length)}
                    pending={quotations.isPending}
                    tone={awaiting.length > 0 ? 'warning' : 'neutral'}
                    onPress={go(`${CORPORATE_QUOTATIONS_HREF}?state=quoted`)}
                />
                <StatTile
                    testID="corporate-dashboard-stats-open"
                    label={t('business:overview.kpiOpen')}
                    value={formatter.formatNumber(open)}
                    pending={quotations.isPending}
                    tone="neutral"
                    onPress={go(`${CORPORATE_QUOTATIONS_HREF}?state=open`)}
                />
                <StatTile
                    testID="corporate-dashboard-stats-accepted"
                    label={t('business:overview.kpiAccepted')}
                    value={formatter.formatNumber(accepted)}
                    pending={quotations.isPending}
                    tone="neutral"
                    onPress={go(`${CORPORATE_QUOTATIONS_HREF}?state=closed`)}
                />
                <StatTile
                    testID="corporate-dashboard-stats-programmes"
                    label={t('business:overview.kpiProgrammes')}
                    value={formatter.formatNumber(running)}
                    pending={programmes.isPending}
                    tone="neutral"
                    {...(first === undefined
                        ? {}
                        : { onPress: go(corporateCatalogueHref(String(first.id))) })}
                />
            </View>

            <View className={wide ? 'flex-row items-start gap-3' : 'gap-3'}>
                <View className={cx('min-w-0 gap-3', wide ? 'flex-[1.3]' : '')}>
                    <Panel
                        testID="corporate-waiting"
                        title={t('business:overview.waitingTitle')}
                        count={
                            <CountPill
                                testID="corporate-waiting-count"
                                value={String(awaiting.length)}
                                tone={awaiting.length > 0 ? 'warning' : 'ok'}
                            />
                        }
                        link={{
                            label: t('business:overview.allQuotations'),
                            onPress: go(CORPORATE_QUOTATIONS_HREF),
                        }}
                    >
                        {quotations.isPending ? (
                            <Skeleton heightClassName="h-12" widthClassName="w-full" />
                        ) : quotationsFailure !== null ? (
                            <ErrorState
                                testID="corporate-quotations-error"
                                title={t('business:quotations.loadErrorTitle')}
                                failure={quotationsFailure}
                                onRetry={() => {
                                    void quotations.refetch();
                                }}
                                retrying={quotations.isFetching}
                            />
                        ) : awaiting.length === 0 && submitted.length === 0 ? (
                            <Text tone="secondary" className="px-3 pb-3">
                                {t('business:overview.waitingEmpty')}
                            </Text>
                        ) : (
                            <>
                                {awaiting.map((row) => (
                                    <View
                                        key={row.reference}
                                        testID={`corporate-waiting-${row.reference}`}
                                        className="min-h-[52px] flex-row items-center gap-3 rounded-xl py-1.5 pe-2 ps-3 hover:bg-surface-sunken web:transition-colors"
                                    >
                                        <RowIcon tone="warning" />
                                        <RowText
                                            title={row.reference}
                                            sub={
                                                row.expiresAt === null
                                                    ? t('business:overview.waitingPricedNoExpiry', {
                                                          lines: linesText(row),
                                                      })
                                                    : t('business:overview.waitingPriced', {
                                                          lines: linesText(row),
                                                          date: formatter.formatDate(
                                                              row.expiresAt,
                                                              {
                                                                  weekday: 'short',
                                                                  day: 'numeric',
                                                                  month: 'short',
                                                              },
                                                          ),
                                                      })
                                            }
                                        />
                                        <Total row={row} />
                                        <Button
                                            testID={`corporate-waiting-${row.reference}-view`}
                                            variant="secondary"
                                            size="sm"
                                            label={t('business:overview.view')}
                                            onPress={view(row)}
                                        />
                                        <Button
                                            testID={`corporate-waiting-${row.reference}-decline`}
                                            variant="quiet"
                                            size="sm"
                                            label={t('business:overview.decline')}
                                            onPress={() => {
                                                setDeciding({ quotation: row, kind: 'decline' });
                                            }}
                                        />
                                        <Button
                                            testID={`corporate-waiting-${row.reference}-accept`}
                                            size="sm"
                                            label={t('business:overview.accept')}
                                            onPress={() => {
                                                setDeciding({ quotation: row, kind: 'accept' });
                                            }}
                                        />
                                    </View>
                                ))}
                                {submitted.map((row) => (
                                    <Pressable
                                        key={row.reference}
                                        testID={`corporate-waiting-${row.reference}`}
                                        role="link"
                                        accessibilityRole="link"
                                        onPress={view(row)}
                                        className="min-h-11 flex-row items-center gap-3 rounded-xl py-1.5 pe-2 ps-3 hover:bg-surface-sunken web:transition-colors"
                                    >
                                        <RowIcon tone="info" />
                                        <RowText
                                            title={row.reference}
                                            sub={t('business:overview.waitingSubmitted', {
                                                lines: linesText(row),
                                            })}
                                        />
                                        <DeskChip
                                            tone="info"
                                            label={t('business:overview.awaitingPrice')}
                                        />
                                    </Pressable>
                                ))}
                            </>
                        )}
                    </Panel>

                    <Panel
                        testID="corporate-quotation-summary"
                        title={t('business:overview.latestTitle')}
                        link={{
                            label: t('business:overview.seeAll', { count: all.length }),
                            onPress: go(CORPORATE_QUOTATIONS_HREF),
                        }}
                    >
                        {quotations.isPending ? (
                            <Skeleton heightClassName="h-12" widthClassName="w-full" />
                        ) : recent.length === 0 ? (
                            <EmptyState
                                testID="corporate-quotations-empty"
                                title={t('business:dashboard.noQuotationsTitle')}
                                body={t('business:dashboard.noQuotationsBody')}
                            />
                        ) : (
                            recent.map((row) => (
                                <Pressable
                                    key={row.reference}
                                    testID={`corporate-quotations-row-${row.reference}`}
                                    role="link"
                                    accessibilityRole="link"
                                    onPress={view(row)}
                                    className="min-h-[52px] flex-row items-center gap-3 rounded-xl py-1.5 pe-2 ps-3 hover:bg-surface-sunken web:transition-colors"
                                >
                                    <RowText
                                        title={row.reference}
                                        sub={t('business:overview.latestSub', {
                                            lines: linesText(row),
                                            date: formatter.formatDate(row.requestedAt, {
                                                dateStyle: 'medium',
                                            }),
                                        })}
                                    />
                                    <DeskChip
                                        tone={quotationTone(row.state)}
                                        label={t(quotationStateKey(row.state))}
                                    />
                                    <View className="min-w-[86px] items-end">
                                        <Total row={row} />
                                    </View>
                                </Pressable>
                            ))
                        )}
                    </Panel>
                </View>

                <View className={cx('min-w-0 gap-3', wide ? 'flex-1' : '')}>
                    {programmes.isPending ? (
                        <Skeleton heightClassName="h-40" widthClassName="w-full" />
                    ) : programmesFailure !== null ? (
                        <ErrorState
                            testID="corporate-programmes-error"
                            title={t('business:dashboard.loadErrorTitle')}
                            failure={programmesFailure}
                            onRetry={() => {
                                void programmes.refetch();
                            }}
                            retrying={programmes.isFetching}
                        />
                    ) : programmeList.length === 0 ? (
                        <EmptyState
                            testID="corporate-programmes-empty"
                            title={t('business:dashboard.emptyTitle')}
                            body={t('business:dashboard.emptyBody')}
                        />
                    ) : (
                        programmeList.map((programme) => (
                            <ProgrammeCard key={String(programme.id)} programme={programme} />
                        ))
                    )}
                    <LookupCard />
                </View>
            </View>

            {deciding === null ? null : deciding.kind === 'accept' ? (
                <AcceptQuotationDialog
                    quotation={deciding.quotation}
                    kitchenId={programmeOf(deciding.quotation)?.kitchenIds[0] ?? null}
                    onClose={() => {
                        setDeciding(null);
                    }}
                    onAccepted={(done) => {
                        setDeciding(null);
                        toast.show({
                            tone: 'success',
                            message: t('business:accept.placedTitle', {
                                order: done.orderNumber ?? done.reference,
                            }),
                        });
                    }}
                />
            ) : (
                <DeclineQuotationDialog
                    quotation={deciding.quotation}
                    onClose={() => {
                        setDeciding(null);
                    }}
                    onDeclined={(done) => {
                        setDeciding(null);
                        toast.show({
                            tone: 'info',
                            message: t('business:overview.declined', { reference: done.reference }),
                        });
                    }}
                />
            )}
        </Cascade>
    );
}

/** The round mark at a row's start: amber for a price waiting on you, blue for one being made. */
function RowIcon({ tone }: { readonly tone: 'warning' | 'info' }) {
    return (
        <View
            aria-hidden
            className={cx(
                'h-[34px] w-[34px] items-center justify-center rounded-full',
                tone === 'warning' ? 'bg-warning-subtle' : 'bg-info-subtle',
            )}
        >
            <Icon
                name={tone === 'warning' ? 'fileText' : 'clock'}
                size="sm"
                className={tone === 'warning' ? 'text-warning-on-subtle' : 'text-info-on-subtle'}
            />
        </View>
    );
}

function RowText({ title, sub }: { readonly title: string; readonly sub: string }) {
    return (
        <View className="min-w-0 flex-1">
            <Text variant="bodyStrong" numberOfLines={1} className="tabular-nums">
                {title}
            </Text>
            <Text variant="caption" tone="secondary" numberOfLines={1} className="tabular-nums">
                {sub}
            </Text>
        </View>
    );
}

/** A quotation's total, or a dash while it is not priced. */
function Total({ row }: { readonly row: Quotation }) {
    const formatter = useFormatter();
    return (
        <Text
            testID={
                row.requestedTotal === null
                    ? undefined
                    : contractPriceTestId(`overview-total-${row.reference}`)
            }
            className="font-display text-base font-bold tabular-nums"
        >
            {row.requestedTotal === null ? '—' : formatMoney(formatter, row.requestedTotal)}
        </Text>
    );
}

/** One programme: its name, what it is for, and the three facts the API carries about it. */
function ProgrammeCard({ programme }: { readonly programme: CorporateProgramme }) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const catalogue = useCorporateCatalogueQuery({ programmeId: programme.id });
    const kitchen = useKitchenQuery(programme.kitchenIds[0] ?? null);
    const lines = catalogue.data?.totalCount ?? catalogue.data?.items.length;
    const id = String(programme.id);

    return (
        <Panel
            testID={`corporate-programme-${id}`}
            title={t('business:overview.programmeTitle')}
            count={
                <DeskChip
                    testID={`corporate-programme-${id}-state`}
                    tone={programme.isActive ? 'success' : 'neutral'}
                    label={
                        programme.isActive
                            ? t('business:programme.active')
                            : t('business:programme.inactive')
                    }
                />
            }
            link={{
                label: t('business:overview.catalogue'),
                onPress: () => {
                    router.push(corporateCatalogueHref(id) as never);
                },
            }}
        >
            <View className="px-3 pb-3">
                <Heading
                    level={3}
                    testID={`corporate-programme-${id}-name`}
                    className="!text-[22px] !leading-7"
                >
                    {programme.name}
                </Heading>
                {programme.summary === '' ? null : (
                    <Text variant="caption" tone="secondary" className="mt-0.5">
                        {programme.summary}
                    </Text>
                )}
                <View className="mt-2 border-t border-stroke-subtle pt-2">
                    <Fact
                        label={t('business:overview.kitchen')}
                        value={kitchen.data?.name ?? '—'}
                    />
                    <Fact
                        testID={`corporate-programme-${id}-lines`}
                        label={t('business:overview.linesAtRates')}
                        value={lines === undefined ? '…' : formatter.formatNumber(lines)}
                    />
                    {programme.startsAt === '' ? null : (
                        <Fact
                            testID={`corporate-programme-${id}-term`}
                            label={t('business:overview.runningSince')}
                            value={formatter.formatDate(programme.startsAt, {
                                dateStyle: 'medium',
                            })}
                        />
                    )}
                </View>
            </View>
        </Panel>
    );
}

function Fact({
    label,
    value,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly testID?: string | undefined;
}) {
    return (
        <View className="min-h-[34px] flex-row items-center justify-between gap-3">
            <Text tone="secondary">{label}</Text>
            <Text testID={testID} variant="bodyStrong" className="tabular-nums">
                {value}
            </Text>
        </View>
    );
}

/** *Open a line by its code* — straight to the catalogue line, from a code someone pasted. */
function LookupCard() {
    const { t } = useTranslation();
    const router = useRouter();
    const [code, setCode] = useState('');
    const openLookup = () => {
        if (code.trim() === '') return;
        router.push(`/corporate/items/${encodeURIComponent(code.trim())}` as never);
    };
    return (
        <Panel testID="corporate-lookup" title={t('business:overview.lookupTitle')}>
            <View className="flex-row items-center gap-2 px-3 pb-3">
                <SearchInput
                    testID="corporate-lookup-code"
                    size="sm"
                    label={t('business:dashboard.lookupLabel')}
                    placeholder={t('business:dashboard.lookupPlaceholder')}
                    value={code}
                    onChangeText={setCode}
                    onSubmitEditing={openLookup}
                    className="min-w-0 flex-1"
                />
                <Button
                    testID="corporate-lookup-open"
                    variant="secondary"
                    size="sm"
                    label={t('business:dashboard.lookupOpen')}
                    disabled={code.trim() === ''}
                    onPress={openLookup}
                />
            </View>
        </Panel>
    );
}
