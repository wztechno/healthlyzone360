import type { OrderDeskRequirement } from '@healthy360/api-client/contracts';
import {
    Callout,
    Cascade,
    EmptyState,
    ErrorState,
    Icon,
    TableSkeleton,
    Text,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useOrderDeskRequirementsQuery } from '../../../data/order-desk-hooks.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { addDays, todayIso } from '../../commerce/dates.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import {
    INVENTORY_ORDER_SUPPLIES_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { unitCodeLabel } from '../format.ts';
import { PeriodScope } from '../catalogue/period-scope.tsx';
import { pathnameOf } from '../../../navigation/return-to.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { PageBackPill, useAreaTrailDrawn } from '../../../shell/area-trail.tsx';
import { LensBar } from '../catalogue/lens-bar.tsx';
import { ORDERS_HREF } from '../orders/orders-url.ts';
import { shortDay } from '../orders/order-columns.tsx';
import { DeskButton, DeskColumnPicker, DeskSelect, MiniMonthPicker } from '../desk-kit/index.ts';
import type { LensFigure } from '../catalogue/lens-bar.tsx';

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
 * `onHand`, `reserved` and `available` are three columns rather than one because the drop between
 * the first and the third needs explaining: `available` is net of what confirmed production orders
 * have claimed (PROD1), so a buyer looking at a full shelf and a buy suggestion beside it can see
 * that the flour is spoken for rather than missing. `available` may arrive **negative** where more
 * is claimed than is there, and is rendered as it arrives — an over-committed shelf is a real state
 * and clamping it would hide it.
 *
 * A zero in the table is a **true zero**: the server computed it. `available: 0` is a shelf holding
 * none of that thing, not an unknown. The em dash is reserved for what genuinely is not known — a
 * shelf with no resolved unit. The figures above the table, while they load, hold a placeholder
 * rather than any character at all.
 *
 * **What is emphatically not a zero is `not_computable`.** A dish with no recipe, a plan whose menu
 * was never written, a unit that will not convert — those days produce no quantity *and no row*, and
 * a card above the table reports them separately, by count of days and by reason. "Buy nothing
 * for that" and "we could not work out what to buy for that" are opposite statements, and the whole
 * layout exists so a buyer can tell which one they are reading.
 *
 * Rows the shelf cannot cover are emphasised with a `Badge` **and** a tone — never colour alone, the
 * platform's standing rule, and the badge carries a word rather than a dot for exactly that reason.
 *
 * ## The desk's toolbar (2026-11-11)
 *
 * Drawn in the Orders page's kit: the window is two mini-month pills, Show (all / short / covered)
 * and Unit are desk dropdowns, a search narrows by ingredient or code, every column sorts from its
 * header, Show columns is the desk pill with its count, and each row's `⋯` opens the ingredient.
 */

type ShowFilter = 'all' | 'short' | 'covered';
const ALL_UNITS = '\u0000all';

/** What a shelf with no resolved unit renders as — the workspace's one character for an unknown. */
const EM_DASH = '—';

/** How far ahead the screen opens on: today plus a fortnight, inside the server's month-long cap. */
const DEFAULT_WINDOW_DAYS = 13;

/** The server's cap on a window, in days, both ends counted. */
const MAX_WINDOW_DAYS = 31;

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
    const router = useRouter();
    const canOrder = useCan(INVENTORY_ORDER_SUPPLIES_PERMISSION);

    const branchId = access.branch?.id ?? null;
    const today = todayIso();
    const [show, setShow] = useState<ShowFilter>('all');
    const [unit, setUnit] = useState<string>(ALL_UNITS);
    const [query, setQuery] = useState('');

    // `?from=&to=` opens on a span another page asked about — the Orders calendar's "Open
    // requirements" for one day.
    const asked = useLocalSearchParams<{ from?: string; to?: string; returnTo?: string }>();
    // Opened from the Orders calendar's "Open requirements": one press back to that day.
    const back = useReturnTo(asked.returnTo, ORDERS_HREF);
    // The top bar's trail is the way back where it is drawn — one control per screen.
    const trailDrawn = useAreaTrailDrawn();
    const askedFrom = typeof asked.from === 'string' && isIsoDate(asked.from) ? asked.from : null;
    const askedTo = typeof asked.to === 'string' && isIsoDate(asked.to) ? asked.to : null;
    /**
     * The window the page opened on — the span another page asked about, else the next two weeks —
     * and what Clear goes back to. `addDays` answers `null` for a date it cannot read; today's own
     * is never one, and the fallback keeps the window a single day rather than an empty box.
     */
    const [opening] = useState(() => {
        const start = askedFrom ?? today;
        const end =
            (askedFrom !== null && askedTo !== null && askedTo >= askedFrom ? askedTo : null) ??
            addDays(today, DEFAULT_WINDOW_DAYS) ??
            today;
        return { from: start, to: end };
    });
    const [from, setFromDay] = useState(opening.from);
    const [to, setToDay] = useState(opening.to);
    /*
     * The window stays one the server answers: never backwards, never past its month. Moving one
     * end over the other carries the other along, and a span stretched past the cap pulls the far
     * end in — so a pick always lands on a list rather than on "name a window".
     */
    const setFrom = (day: string) => {
        setFromDay(day);
        const farthest = addDays(day, MAX_WINDOW_DAYS - 1) ?? day;
        if (to < day) setToDay(day);
        else if (to > farthest) setToDay(farthest);
    };
    const setTo = (day: string) => {
        setToDay(day);
        const earliest = addDays(day, -(MAX_WINDOW_DAYS - 1)) ?? day;
        if (from > day) setFromDay(day);
        else if (from < earliest) setFromDay(earliest);
    };
    const windowMoved = from !== opening.from || to !== opening.to;

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

    const shortRows = (requirements.data?.requirements ?? []).filter((row) => isShort(row));
    const shortIds = shortRows.map((row) => row.stockItemId);
    const shortCount = shortIds.length;

    /**
     * The shortfall, handed to the supply-order builder as the items it proposes. The proposal
     * endpoint takes at most 100 ids, so a longer list hands over its first 100.
     */
    const createOrder = () => {
        router.push(
            withReturnTo(
                withQuery('/kitchen/supply-orders/new', {
                    items: shortIds.slice(0, 100).join(','),
                    // What each short row suggests buying, so the builder opens filled and ticked.
                    qty: shortRows
                        .slice(0, 100)
                        .map((row) => `${row.stockItemId}:${row.suggestedBuy}`)
                        .join(','),
                }),
                back.carry(withQuery('/kitchen/order-desk/requirements', { from, to })),
            ) as never,
        );
    };

    const columns: readonly ControlledColumn<
        OrderDeskRequirement,
        CatalogueColumn<OrderDeskRequirement>
    >[] = [
        {
            key: 'ingredient',
            role: 'title',
            value: (row) => row.nameEn,
            label: t('kitchen:ops.requirements.columnIngredient'),
            width: 220,
            priority: 100,
            sort: (left, right, direction) => compareText(left.nameEn, right.nameEn, direction),
            render: (row) => (
                <Text variant="strong" testID={`${rowTestId(row)}-name`}>
                    {row.nameEn}
                </Text>
            ),
        },
        {
            key: 'required',
            label: t('kitchen:ops.requirements.columnRequired'),
            width: 100,
            priority: 95,
            sort: (left, right, direction) =>
                compareNumber(Number(left.required), Number(right.required), direction),
            render: (row) => (
                <Text variant="mono" testID={`${rowTestId(row)}-required`}>
                    {quantity(row.required)}
                </Text>
            ),
        },
        {
            key: 'onHand',
            label: t('kitchen:ops.requirements.columnOnHand'),
            width: 100,
            priority: 55,
            sort: (left, right, direction) =>
                compareNumber(Number(left.onHand), Number(right.onHand), direction),
            render: (row) => (
                <Text variant="mono" tone="secondary" testID={`${rowTestId(row)}-on-hand`}>
                    {quantity(row.onHand)}
                </Text>
            ),
        },
        {
            key: 'reserved',
            label: t('kitchen:ops.requirements.columnReserved'),
            width: 100,
            priority: 60,
            sort: (left, right, direction) =>
                compareNumber(Number(left.reserved), Number(right.reserved), direction),
            render: (row) => (
                <Text
                    variant="mono"
                    tone={Number(row.reserved) > 0 ? 'primary' : 'secondary'}
                    testID={`${rowTestId(row)}-reserved`}
                >
                    {quantity(row.reserved)}
                </Text>
            ),
        },
        {
            key: 'available',
            label: t('kitchen:ops.requirements.columnAvailable'),
            width: 100,
            priority: 80,
            sort: (left, right, direction) =>
                compareNumber(Number(left.available), Number(right.available), direction),
            render: (row) => (
                <Text variant="mono" tone="secondary" testID={`${rowTestId(row)}-available`}>
                    {quantity(row.available)}
                </Text>
            ),
        },
        {
            key: 'short',
            role: 'metric',
            label: t('kitchen:ops.requirements.columnShort'),
            width: 100,
            priority: 90,
            sort: (left, right, direction) =>
                compareNumber(Number(left.short), Number(right.short), direction),
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
            sort: (left, right, direction) =>
                compareNumber(Number(left.suggestedBuy), Number(right.suggestedBuy), direction),
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
            sort: (left, right, direction) =>
                compareText(unitText(left), unitText(right), direction),
            render: (row) => (
                <Text variant="mono" tone="secondary" testID={`${rowTestId(row)}-unit`}>
                    {/* The one genuine unknown on this row. A shelf with no resolved unit still has
                        real quantities; it is the label for them that is missing. */}
                    {row.unitCode === null ? EM_DASH : unitCodeLabel(row.unitCode, t)}
                </Text>
            ),
        },
    ];

    function unitText(row: OrderDeskRequirement): string {
        return row.unitCode === null ? EM_DASH : unitCodeLabel(row.unitCode, t);
    }

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
    const units = [...new Set(rows.map((row) => row.unitCode ?? EM_DASH))].sort();
    const needle = query.trim().toLocaleLowerCase();
    const narrowed = rows.filter(
        (row) =>
            (show === 'all' || (show === 'short') === isShort(row)) &&
            (unit === ALL_UNITS || (row.unitCode ?? EM_DASH) === unit) &&
            (needle === '' ||
                row.nameEn.toLocaleLowerCase().includes(needle) ||
                row.code.toLocaleLowerCase().includes(needle)),
    );
    const toolbarFiltered = show !== 'all' || unit !== ALL_UNITS || needle !== '' || windowMoved;
    /** View and Edit for the ingredient behind a row, coming back here. */
    const rowActions = (row: OrderDeskRequirement): readonly MenuItem[] => {
        const here = back.carry(withQuery('/kitchen/order-desk/requirements', { from, to }));
        return [
            {
                key: 'view',
                label: t('kitchen:ops.requirements.viewIngredient'),
                icon: 'eye',
                primary: true,
                onSelect: () => {
                    router.push(
                        withReturnTo(
                            withQuery('/kitchen/ingredients', { view: row.ingredientId }),
                            here,
                        ) as never,
                    );
                },
            },
            {
                key: 'edit',
                label: t('kitchen:ops.requirements.editIngredient'),
                icon: 'pen',
                onSelect: () => {
                    router.push(
                        withReturnTo(`/kitchen/ingredients/${row.ingredientId}`, here) as never,
                    );
                },
            },
        ];
    };
    /*
     * The catalogue's six, like every admin table. Reserved and Available are the two left out:
     * Available is On hand less Reserved, so the row still reads, and a quantity without its Unit
     * would not. The picker swaps them in.
     */
    const controls = useColumnControls(narrowed, columns, 'kitchen-order-desk-requirements-table', {
        menuLook: 'card',
        picker: {
            defaults: ['ingredient', 'required', 'onHand', 'short', 'suggestedBuy', 'unit'],
        },
    });

    /** Rows on screen: the toolbar card then runs on into the table rather than closing above it. */
    const joined =
        branchId !== null &&
        filters !== null &&
        !requirements.isPending &&
        failure === null &&
        controls.rows.length > 0;

    return (
        <Cascade space="md" testID="kitchen-order-desk-requirements-screen">
            {back.returnTo === null || trailDrawn ? null : (
                <View className="flex-row">
                    <PageBackPill
                        testID="kitchen-order-desk-requirements-back"
                        label={
                            pathnameOf(back.returnTo) === ORDERS_HREF
                                ? t('kitchen:orders.backToOrders')
                                : t('common:returnTo.previous')
                        }
                        onPress={back.leave}
                    />
                </View>
            )}
            {/*
             * The Lens bar: the window's figures over the window that produces them, as on every
             * list page. While the window is in flight each figure holds a placeholder — a zero
             * there would claim an answer the screen does not have yet. The branch is the
             * workspace's — see the file header.
             */}
            {/* One block, so the toolbar card runs straight on into the table. */}
            <View className={joined ? 'z-10' : 'z-10 gap-4'}>
                <LensBar
                    testID="kitchen-order-desk-requirements-toolbar"
                    layout="split"
                    compactSearch
                    joined={joined}
                    label={t('kitchen:lens.label')}
                    figures={(() => {
                        const unknown = branchId === null || filters === null || failure !== null;
                        const figure = (count: number): Pick<LensFigure, 'value' | 'display'> =>
                            unknown
                                ? { value: 0, display: t('kitchen:list.noValue') }
                                : requirements.isPending
                                  ? { value: null }
                                  : { value: count, display: formatter.formatNumber(count) };
                        const holes = notComputable?.days ?? 0;
                        return [
                            {
                                key: 'ingredients',
                                label: t('kitchen:ops.requirements.kpiIngredients'),
                                ...figure(rows.length),
                            },
                            {
                                key: 'short',
                                label: t('kitchen:ops.requirements.kpiShort'),
                                ...figure(shortCount),
                                tone: 'danger',
                                alarm: true,
                                separated: true,
                            },
                            {
                                key: 'notComputable',
                                label: t('kitchen:ops.requirements.kpiNotComputable'),
                                ...figure(holes),
                                tone: 'warning',
                                // Why those days could not be worked out — the one figure whose
                                // answer needs a sentence.
                                ...(notComputable !== null && holes > 0
                                    ? { info: reasonSummary(notComputable.reasons) }
                                    : {}),
                            },
                        ];
                    })()}
                    {...(requirements.isPending || rows.length === 0
                        ? {}
                        : {
                              mix: [
                                  { key: 'short', value: shortCount, tone: 'danger' as const },
                                  {
                                      key: 'covered',
                                      value: rows.length - shortCount,
                                      tone: 'success' as const,
                                  },
                              ],
                              mixLabel: t('kitchen:lens.requirementsMix', {
                                  short: shortCount,
                                  covered: rows.length - shortCount,
                              }),
                          })}
                    scope={
                        <>
                            <PeriodScope
                                look="desk"
                                unit="ahead"
                                testID="kitchen-order-desk-requirements-period"
                                today={today}
                                value={{ from, to }}
                                onChange={(next) => {
                                    // Both ends at once: a shortcut is already a whole window.
                                    setFromDay(next.from);
                                    setToDay(next.to);
                                }}
                            />
                            <MiniMonthPicker
                                testID="kitchen-order-desk-requirements-from"
                                label={t('kitchen:ops.requirements.filterFrom')}
                                value={isIsoDate(from) ? from : today}
                                valueLabel={isIsoDate(from) ? shortDay(from, formatter) : from}
                                today={today}
                                onChange={setFrom}
                            />
                            <Text variant="caption" tone="secondary" aria-hidden>
                                {t('kitchen:ops.requirements.windowTo')}
                            </Text>
                            <MiniMonthPicker
                                testID="kitchen-order-desk-requirements-to"
                                label={t('kitchen:ops.requirements.filterTo')}
                                value={isIsoDate(to) ? to : today}
                                valueLabel={isIsoDate(to) ? shortDay(to, formatter) : to}
                                today={today}
                                onChange={setTo}
                            />
                            <DeskSelect<ShowFilter>
                                testID="kitchen-order-desk-requirements-show"
                                label={t('kitchen:ops.requirements.showLabel')}
                                value={show}
                                onChange={setShow}
                                options={[
                                    {
                                        value: 'all',
                                        label: t('kitchen:ops.requirements.showAll'),
                                    },
                                    {
                                        value: 'short',
                                        label: t('kitchen:ops.requirements.showShort'),
                                        count: shortCount,
                                    },
                                    {
                                        value: 'covered',
                                        label: t('kitchen:ops.requirements.showCovered'),
                                        count: rows.length - shortCount,
                                    },
                                ]}
                            />
                            <DeskSelect<string>
                                testID="kitchen-order-desk-requirements-unit"
                                label={t('kitchen:ops.requirements.columnUnit')}
                                value={unit}
                                onChange={setUnit}
                                options={[
                                    {
                                        value: ALL_UNITS,
                                        label: t('kitchen:ops.requirements.unitAll'),
                                    },
                                    ...units.map((code) => ({
                                        value: code,
                                        label: code === EM_DASH ? EM_DASH : unitCodeLabel(code, t),
                                    })),
                                ]}
                            />
                        </>
                    }
                    search={query}
                    onSearchChange={setQuery}
                    searchLabel={t('kitchen:ops.requirements.searchLabel')}
                    searchPlaceholder={t('kitchen:ops.requirements.searchPlaceholder')}
                    result={
                        requirements.isPending && branchId !== null && filters !== null
                            ? null
                            : t('kitchen:lens.result', {
                                  shown: controls.rows.length,
                                  total: rows.length,
                              })
                    }
                    clearLabel={t('kitchen:lens.clear')}
                    {...(controls.filtered || toolbarFiltered
                        ? {
                              onClear: () => {
                                  controls.clearFilters();
                                  setShow('all');
                                  setUnit(ALL_UNITS);
                                  setQuery('');
                                  setFromDay(opening.from);
                                  setToDay(opening.to);
                              },
                          }
                        : {})}
                    trailing={<DeskColumnPicker {...controls.picker} />}
                    {...(canOrder && shortCount > 0
                        ? {
                              actions: (
                                  <DeskButton
                                      testID="kitchen-order-desk-requirements-create-order"
                                      label={t('kitchen:ops.requirements.createOrder')}
                                      iconStart={
                                          <Icon
                                              name="plus"
                                              size="md"
                                              className="text-content-on-brand"
                                          />
                                      }
                                      onPress={createOrder}
                                  />
                              ),
                          }
                        : {})}
                />

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
                    <TableSkeleton testID="kitchen-order-desk-requirements-loading" rows={6} />
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
                        {rows.length === 0 ? (
                            <CatalogueList<OrderDeskRequirement>
                                testID="kitchen-order-desk-requirements-table"
                                label={t('kitchen:ops.requirements.title')}
                                columns={controls.columns}
                                rows={[]}
                                rowKey={(row) => row.stockItemId}
                                rowActionsLabel={t('kitchen:list.rowActions')}
                                joined
                                frameEmpty
                                emptyState={
                                    <EmptyState
                                        testID="kitchen-order-desk-requirements-empty"
                                        shape="table"
                                        icon="clipboardCheck"
                                        title={t('kitchen:ops.requirements.noRowsTitle')}
                                        body={t('kitchen:ops.requirements.noRowsBody')}
                                    />
                                }
                            />
                        ) : (
                            <CatalogueList<OrderDeskRequirement>
                                testID="kitchen-order-desk-requirements-table"
                                label={t('kitchen:ops.requirements.title')}
                                columns={controls.columns}
                                rows={controls.rows}
                                rowKey={(row) => row.stockItemId}
                                rowActions={rowActions}
                                rowActionsLabel={t('kitchen:list.rowActions')}
                                rowActionsLook="desk"
                                joined
                            />
                        )}
                    </View>
                )}
            </View>
        </Cascade>
    );
}

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
