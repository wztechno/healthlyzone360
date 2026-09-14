import type { OrderDeskRequirement } from '@healthy360/api-client/contracts';
import {
    Badge,
    Callout,
    DataList,
    EmptyState,
    ErrorState,
    Skeleton,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { DataListColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useOrderDeskRequirementsQuery } from '../../../data/order-desk-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { addDays, todayIso } from '../../commerce/dates.ts';
import { CataloguePageHeader, CatalogueSummaryBar } from '../catalogue/index.ts';
import { INVENTORY_VIEW_PERMISSION } from '../entity-registry.ts';
import { DeskFootnote } from '../order-desk/desk-parts.tsx';

/**
 * `/kitchen/order-desk/requirements` — what this branch must buy to cook the days ahead.
 *
 * ## The third view of one forward book
 *
 * The queue is that book in the order it has to be worked; the calendar is its shape by day; this is
 * the same commitments **by ingredient**, weighed against a shelf. Nothing here is created and
 * nothing is written — ordering the goods happens on the purchasing surface and counting them on the
 * stock one — which is why the family is a `workbench` card with no manage permission.
 *
 * ## A branch is required before anything is asked, and the screen says why
 *
 * Every other order-desk read is organisation-wide by default and takes `branch_id` as an optional
 * narrowing. This one refuses without it, because half the answer is *how much is on the shelf* and
 * there is no organisation-wide shelf: adding three sites' quantities together would tell a buyer
 * they have flour while the kitchen that needs it has none.
 *
 * So when the workspace has no active branch, this screen **does not fetch**. It renders the reason
 * instead. That is the honest arrangement rather than a defensive one: a request that omitted the
 * branch would come back a `422`, and an error page saying "validation failed" would explain nothing
 * to somebody whose only mistake was holding an organisation-wide membership.
 *
 * In practice that refusal is belt and braces: `kitchen` is one of the areas the guard marks
 * `requiresBranch`, so a member with none selected meets the branch picker before they ever reach
 * this route. It is kept anyway, because a data precondition that lives only in a routing table is
 * one refactor away from living nowhere — and because the fetch gate is what actually stops the
 * request, whichever layer noticed first.
 *
 * The branch comes from `useAccessState()` — the same `access.branch?.id` the stock, procurement and
 * production screens read — and is sent as the desk family's **query parameter** rather than as the
 * `X-Branch-Id` header those screens rely on. One workspace concept, two wire conventions, because
 * the desk endpoints were built for an agent who may hold no branch at all. An in-screen picker that
 * let an organisation-wide manager choose a shelf without changing their whole context belongs to a
 * later slice, on the same terms the queue and the calendar recorded for theirs.
 *
 * ## Em dashes, zeroes, and the one thing that must never be confused
 *
 * A zero in the table is a **true zero**: the server computed it. `available: 0` is a shelf holding
 * none of that thing, not an unknown. The em dash is reserved for what genuinely is not known — a
 * shelf with no resolved unit, and the ops metrics while they are still loading.
 *
 * **What is emphatically not a zero is `not_computable`.** A dish with no recipe, a plan whose menu
 * was never written, a unit that will not convert — those days produce no quantity *and no row*, and
 * the panel above the table reports them separately, by count of days and by reason. "Buy nothing
 * for that" and "we could not work out what to buy for that" are opposite statements, and the whole
 * layout exists so a buyer can tell which one they are reading.
 *
 * Rows the shelf cannot cover are emphasised with a `Badge` **and** a tone — never colour alone, the
 * platform's standing rule, and the badge carries a word rather than a dot for exactly that reason.
 */

/** What a shelf with no resolved unit renders as — the workspace's one character for an unknown. */
const EM_DASH = '—';

/** How far ahead the screen opens on: today plus a fortnight, inside the server's month-long cap. */
const DEFAULT_WINDOW_DAYS = 13;

export function OrderDeskRequirementsScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-order-desk-requirements"
        >
            <OrderDeskRequirements />
        </Gate>
    );
}

function OrderDeskRequirements() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const access = useAccessState();

    const branchId = access.branch?.id ?? null;

    const [from, setFrom] = useState(() => todayIso());
    // `addDays` answers `null` for a date it cannot read; today's own is never one, and the
    // fallback keeps the initial state a single day rather than an empty box.
    const [to, setTo] = useState(() => addDays(todayIso(), DEFAULT_WINDOW_DAYS) ?? todayIso());

    /**
     * The question, or `null` when there is nothing askable yet.
     *
     * Memoised because the hook keys on the whole object (query-key shape rule 3) — a fresh literal
     * every render would be a fresh cache entry every render. `null` covers both "no branch" and a
     * half-typed date: `2026-0` is not a window, and asking for it would spend a `422` per keystroke.
     */
    const filters = useMemo(() => {
        if (branchId === null || !isIsoDate(from) || !isIsoDate(to) || to < from) {
            return null;
        }

        return { from, to, branchId };
    }, [branchId, from, to]);

    const requirements = useOrderDeskRequirementsQuery(filters);

    const notComputable = requirements.data?.notComputable ?? null;

    const shortCount = (requirements.data?.requirements ?? []).filter((row) => isShort(row)).length;

    /**
     * The summary line: how much there is to buy, how much of it is short, and how much of the
     * window nobody could answer.
     *
     * Absent while nothing has answered — a zero here would claim an answer the screen does not have
     * yet — and each figure is a segment only when it has something to say, so a window with nothing
     * short does not announce "0 short".
     */
    const summary: readonly string[] =
        requirements.data === undefined
            ? [t('kitchen:ops.requirements.subtitle')]
            : [
                  t('kitchen:ops.requirements.summaryIngredients', {
                      count: requirements.data.requirements.length,
                  }),
                  ...(shortCount === 0
                      ? []
                      : [t('kitchen:ops.requirements.summaryShort', { count: shortCount })]),
                  ...(notComputable === null || notComputable.days === 0
                      ? []
                      : [
                            t('kitchen:ops.requirements.notComputableTitle', {
                                count: notComputable.days,
                            }),
                        ]),
                  t('kitchen:ops.requirements.summaryReadOnly'),
              ];

    const columns: readonly DataListColumn<OrderDeskRequirement>[] = [
        {
            key: 'ingredient',
            label: t('kitchen:ops.requirements.columnIngredient'),
            width: 220,
            priority: 100,
            render: (row) => (
                <View className="flex-row flex-wrap items-baseline gap-tight">
                    <Text variant="strong" testID={`${rowTestId(row)}-name`}>
                        {row.nameEn}
                    </Text>
                    <Text variant="mono" tone="secondary">
                        {row.code}
                    </Text>
                </View>
            ),
        },
        {
            key: 'required',
            label: t('kitchen:ops.requirements.columnRequired'),
            width: 100,
            priority: 95,
            align: 'end',
            render: (row) => (
                <Text variant="mono" testID={`${rowTestId(row)}-required`}>
                    {quantity(row.required)}
                </Text>
            ),
        },
        {
            key: 'available',
            label: t('kitchen:ops.requirements.columnAvailable'),
            width: 100,
            priority: 80,
            align: 'end',
            render: (row) => (
                <Text variant="mono" tone="secondary" testID={`${rowTestId(row)}-available`}>
                    {quantity(row.available)}
                </Text>
            ),
        },
        {
            key: 'short',
            label: t('kitchen:ops.requirements.columnShort'),
            width: 100,
            priority: 90,
            align: 'end',
            render: (row) => (
                <Text
                    variant="mono"
                    testID={`${rowTestId(row)}-short`}
                    tone={isShort(row) ? 'danger' : 'secondary'}
                >
                    {quantity(row.short)}
                </Text>
            ),
        },
        {
            key: 'suggestedBuy',
            label: t('kitchen:ops.requirements.columnSuggestedBuy'),
            width: 110,
            priority: 70,
            align: 'end',
            render: (row) => (
                <Text variant="mono" testID={`${rowTestId(row)}-suggested-buy`}>
                    {quantity(row.suggestedBuy)}
                </Text>
            ),
        },
        {
            key: 'unit',
            label: t('kitchen:ops.requirements.columnUnit'),
            width: 70,
            priority: 60,
            render: (row) => (
                <Text variant="mono" tone="secondary" testID={`${rowTestId(row)}-unit`}>
                    {/* The one genuine unknown on this row. A shelf with no resolved unit still has
                        real quantities; it is the label for them that is missing. */}
                    {row.unitCode ?? EM_DASH}
                </Text>
            ),
        },
        {
            key: 'position',
            label: t('kitchen:ops.requirements.columnPosition'),
            width: 96,
            priority: 85,
            align: 'end',
            // A word, never a dot: the platform's standing rule that colour does not carry a
            // meaning alone. Short and Covered read the same in greyscale.
            render: (row) =>
                isShort(row) ? (
                    <Badge
                        testID={`${rowTestId(row)}-short-badge`}
                        tone="danger"
                        icon="warning"
                        label={t('kitchen:ops.requirements.shortBadge')}
                    />
                ) : (
                    <Badge
                        testID={`${rowTestId(row)}-covered-badge`}
                        tone="success"
                        icon={null}
                        label={t('kitchen:ops.requirements.coveredBadge')}
                    />
                ),
        },
    ];

    /** Quantities are decimal strings on the wire and stay strings until they are rendered. */
    function quantity(value: string): string {
        return formatter.formatNumber(Number(value));
    }

    /**
     * The reasons, as one readable sentence.
     *
     * Each code is looked up **with a fallback to the code itself**, because the server's map is
     * open by design: a reason added next release must reach a buyer as an unfamiliar phrase rather
     * than as a blank space where an explanation should be.
     */
    function reasonSummary(reasons: Readonly<Record<string, number>>): string {
        const parts = Object.entries(reasons).map(([code, days]) =>
            t('kitchen:ops.requirements.reasonEntry', {
                reason: t(`kitchen:ops.requirements.reason.${code}`, { defaultValue: code }),
                days,
            }),
        );

        return parts.length === 0
            ? t('kitchen:ops.requirements.notComputableBody')
            : parts.join(' · ');
    }

    const failure = toFailure(requirements.error);
    const rows = requirements.data?.requirements ?? [];

    return (
        <Stack space="md" testID="kitchen-order-desk-requirements-screen">
            <CataloguePageHeader
                testID="kitchen-order-desk-requirements-header"
                title={t('kitchen:ops.requirements.title')}
                titleTestID="kitchen-order-desk-requirements-title"
            />

            <CatalogueSummaryBar
                testID="kitchen-order-desk-requirements-summary"
                segments={summary}
            />

            {/* One 28px row: the window. The branch is the workspace's — see the file header. */}
            <View
                testID="kitchen-order-desk-requirements-content"
                className="min-h-control-sm flex-row flex-wrap items-center gap-tight"
            >
                <Text variant="micro" tone="secondary">
                    {t('kitchen:ops.requirements.windowLabel')}
                </Text>
                <View style={{ width: DATE_WIDTH }}>
                    <TextInputField
                        testID="kitchen-order-desk-requirements-from"
                        label={t('kitchen:ops.requirements.filterFrom')}
                        labelHidden
                        size="sm"
                        value={from}
                        onChangeText={setFrom}
                        placeholder="YYYY-MM-DD"
                    />
                </View>
                <Text variant="caption" tone="secondary" aria-hidden>
                    {t('kitchen:ops.requirements.windowTo')}
                </Text>
                <View style={{ width: DATE_WIDTH }}>
                    <TextInputField
                        testID="kitchen-order-desk-requirements-to"
                        label={t('kitchen:ops.requirements.filterTo')}
                        labelHidden
                        size="sm"
                        value={to}
                        onChangeText={setTo}
                        placeholder="YYYY-MM-DD"
                    />
                </View>
            </View>

            {branchId === null ? (
                // Friendly rather than an error: the reader did nothing wrong, the list simply
                // needs a shelf to compare against.
                <EmptyState
                    testID="kitchen-order-desk-requirements-branch-required"
                    title={t('kitchen:ops.requirements.branchRequiredTitle')}
                    body={t('kitchen:ops.requirements.branchRequiredBody')}
                />
            ) : filters === null ? (
                <Callout
                    testID="kitchen-order-desk-requirements-window-invalid"
                    tone="info"
                    title={t('kitchen:ops.requirements.windowInvalidTitle')}
                    body={t('kitchen:ops.requirements.windowInvalidBody')}
                />
            ) : requirements.isPending ? (
                <View testID="kitchen-order-desk-requirements-loading" className="flex-col">
                    {Array.from({ length: 6 }, (_, index) => (
                        <View
                            key={index}
                            className="h-row-md flex-row items-center border-b border-stroke-subtle"
                        >
                            <Skeleton heightClassName="h-2" />
                        </View>
                    ))}
                </View>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-order-desk-requirements-error"
                    failure={failure}
                    onRetry={() => {
                        void requirements.refetch();
                    }}
                    retrying={requirements.isFetching}
                />
            ) : (
                <View className="flex-col gap-snug">
                    {notComputable !== null && notComputable.days > 0 ? (
                        <Callout
                            testID="kitchen-order-desk-requirements-not-computable"
                            tone="warning"
                            role="status"
                            title={t('kitchen:ops.requirements.notComputableTitle', {
                                count: notComputable.days,
                            })}
                            body={reasonSummary(notComputable.reasons)}
                        />
                    ) : null}

                    {rows.length === 0 ? (
                        <EmptyState
                            testID="kitchen-order-desk-requirements-empty"
                            title={t('kitchen:ops.requirements.noRowsTitle')}
                            body={t('kitchen:ops.requirements.noRowsBody')}
                        />
                    ) : (
                        <>
                            <DataList<OrderDeskRequirement>
                                testID="kitchen-order-desk-requirements-table"
                                label={t('kitchen:ops.requirements.title')}
                                columns={columns}
                                rows={rows}
                                rowKey={(row) => row.stockItemId}
                            />
                            <DeskFootnote testID="kitchen-order-desk-requirements-footnote">
                                {t('kitchen:ops.requirements.footnote')}
                            </DeskFootnote>
                        </>
                    )}
                </View>
            )}
        </Stack>
    );
}

/** The date fields' width — wide enough for `YYYY-MM-DD`. A style: there is no token for it. */
const DATE_WIDTH = 140;

/** Whether the shelf cannot cover this row. A decimal-string comparison against a true zero. */
function isShort(row: OrderDeskRequirement): boolean {
    return Number(row.short) > 0;
}

function rowTestId(row: OrderDeskRequirement): string {
    return `kitchen-order-desk-requirement-${row.stockItemId}`;
}

/** `YYYY-MM-DD`, and a date that exists. `2026-02-31` parses and is not a day. */
function isIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
