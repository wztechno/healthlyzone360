import type { ConsumptionException } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Cascade,
    DatePickerButton,
    Dialog,
    EmptyState,
    ErrorState,
    Icon,
    SegmentedControl,
    Stack,
    TableSkeleton,
    Text,
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { can } from '@healthy360/permissions';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { KITCHEN_PAGE_SIZE, pagesInResult } from '../../../data/kitchen-admin-hooks.ts';
import {
    useConsumptionExceptionTotalsQuery,
    useConsumptionExceptionsQuery,
    useResolveConsumptionExceptionMutation,
    useRetryConsumptionExceptionMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { ExceptionRowActions } from '../consumption-exceptions/exception-row-actions.tsx';
import {
    canFixInRecipe,
    readStockGapsView,
    recipeFixHref,
    stockGapsHref,
    stockGapsParams,
} from '../consumption-exceptions/stock-gap-fix.ts';
import type {
    StockGapStatus,
    StockGapsRouteParams,
    StockGapsView,
} from '../consumption-exceptions/stock-gap-fix.ts';
import {
    INVENTORY_MANAGE_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
    RECIPE_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { useListPage } from '../use-list-page.ts';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import { compareText, useColumnControls } from '../catalogue/use-column-controls.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { WithColumnPicker } from '../catalogue/column-picker.tsx';

/**
 * `/kitchen/consumption-exceptions` — what a confirmed order could not deduct honestly (INV1.5), as
 * `Workbench.dc.html` draws it (§3.5).
 *
 * ```
 * Consumption exceptions  [ RETRY WRITES STOCK ]
 * ┌ SHOWN ┐ ┌ UNRESOLVED ┐ ┌ RESOLVED ┐
 * STATUS [ Unresolved | Resolved | All ]   RAISED FROM [ 2026-08-01 ▦ ]
 * ORDER              BRANCH         REASON                   RAISED       STATUS
 * 0148               Beirut Central Not enough stock         2026-08-28   [OPEN] Retry Accept gap
 * Grilled chicken …
 * 0151               Beirut Central Recipe line has no qty   2026-08-29   [OPEN] Fix in recipe Retry …
 * Lentil Soup · Red lentils
 * ```
 *
 * Behind `inventory.view_organisation`; Retry and Accept gap only for
 * `inventory.manage_organisation`, Fix in recipe only for `recipe.view_organisation`. Nothing
 * confidential shows — an order number, the sold item and ingredient, the branch, the reason.
 *
 * ## The order cell carries the item underneath
 *
 * Because `unknownOrder` ("Order gone") and `unknownItem` ("Item gone") are different facts and a
 * row can have either. Reasons render the full `exceptions.reasons.*` string — no abbreviation.
 * When the gap names an ingredient, it follows the item, and the record shows it as its own field
 * in place of the raw detail line that carried its id.
 *
 * ## Accept gap is confirmed
 *
 * Accepting (resolving) a permanent stock gap goes through a dialog that says so (the handoff's
 * open question §6.3, answered). Retry is not confirmed: it re-runs the same guarded deduction a
 * confirm uses and cannot deduct twice.
 *
 * ## A gap a recipe fixes leads to the recipe
 *
 * Four reasons are fixed by changing the sold meal's recipe (`stock-gap-fix.ts`). Those rows, and
 * their record, lead with Fix in recipe, which opens the recipe on the field at fault and carries
 * this exact view as `returnTo`. The recipe comes back with `fixed=1`, and Retry is then the
 * record's next step.
 *
 * ## The view lives in the URL
 *
 * Status, raised-from date, page and the open record are seeded from the route's params and
 * written back with `router.setParams` on every change, so Back from a recipe — or a refresh —
 * lands on the same list with the same gap open.
 *
 * ## The cards are whole totals
 *
 * Numbered pages, the admin's one pager: Shown is "18 of 84" from the page's own total, and
 * Unresolved and Resolved come from the count endpoint — they used to count the 25 rows in hand.
 * Unresolved takes the danger ink only while it is non-zero.
 */
export type ConsumptionExceptionsScreenProps = StockGapsRouteParams;

export function ConsumptionExceptionsScreen(props: ConsumptionExceptionsScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_VIEW_PERMISSION] }}
            testID="kitchen-consumption-exceptions"
        >
            <ConsumptionExceptions {...props} />
        </Gate>
    );
}

const EM_DASH = '—';

/** A detail line carrying a raw id says nothing a reader can use; the named fields say it instead. */
const HAS_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function ConsumptionExceptions(params: ConsumptionExceptionsScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const router = useRouter();
    const state = useAccessState();
    const canManage = can(state, INVENTORY_MANAGE_PERMISSION);
    const canViewRecipes = can(state, RECIPE_VIEW_PERMISSION);

    // Seeded once from the URL — the view the list was left on. Every unresolved gap, whenever it
    // opened, is the default: the count the sidebar, the home tile and the cost report link to.
    const [initial] = useState(() => readStockGapsView(params));
    const [status, setStatus] = useState<StockGapStatus>(initial.status);
    const [from, setFrom] = useState(initial.from);
    const [viewingId, setViewingId] = useState<string | null>(initial.gap);
    // The open gap's recipe fix is published: Retry is what is left to do.
    const [fixed, setFixed] = useState(initial.fixed);
    const [resolving, setResolving] = useState<ConsumptionException | null>(null);

    const fromIsValid = from === '' || /^\d{4}-\d{2}-\d{2}$/.test(from);
    const filterKey = `${status}|${fromIsValid ? from : ''}`;
    // The admin's one pager, numbered like every other list. It used to be a cursor "Next page"
    // over 25 rows that the table then cut into its own pages of 18 — two pagers on one list.
    const [page, setPage] = useListPage(filterKey, initial.page);
    const filter = useMemo(
        () => ({
            ...(status === 'all' ? {} : { resolved: status === 'resolved' }),
            ...(from === '' || !fromIsValid ? {} : { from }),
            page,
            perPage: KITCHEN_PAGE_SIZE,
        }),
        [status, from, fromIsValid, page],
    );
    const exceptions = useConsumptionExceptionsQuery(filter);
    // Whole totals for the cards. The list carries none, and counting its rows counted the page.
    const totals = useConsumptionExceptionTotalsQuery();

    const resolve = useResolveConsumptionExceptionMutation();
    const retry = useRetryConsumptionExceptionMutation();
    const [pendingId, setPendingId] = useState<string | null>(null);

    const rows = exceptions.data?.items ?? [];
    const total = exceptions.data?.totalCount ?? null;
    const totalPages = pagesInResult(exceptions.data) ?? 0;
    // Rows up to the end of this page: 18 of 84 on the first, 36 on the second.
    const shownSoFar = Math.min(page * KITCHEN_PAGE_SIZE, total ?? rows.length);
    const unresolved = totals.data?.unresolved ?? null;
    const resolved = totals.data?.resolved ?? null;
    const viewing = viewingId === null ? null : (rows.find((row) => row.id === viewingId) ?? null);

    // A gap the URL names that this page of the list no longer holds — retried from elsewhere, or
    // moved off the page — leaves the list showing rather than an empty record. Adjusted during
    // render once the list has settled, so the address stops naming it too.
    if (viewingId !== null && viewing === null && exceptions.isSuccess && !exceptions.isFetching) {
        setViewingId(null);
        setFixed(false);
    }

    /*
     * The view, written back to the URL on every change — the filter, a card, the date, the pager,
     * opening and closing a record, a retry or an accept. `setParams` replaces the entry, so moving
     * around the list never fills Back with its own states; what it buys is that the address handed
     * to the recipe as `returnTo`, and a refresh, both land on this exact view.
     */
    const view: StockGapsView = {
        status,
        from: fromIsValid ? from : '',
        page,
        gap: viewingId,
        fixed: viewingId !== null && fixed,
    };
    const viewHref = stockGapsHref(view);
    const writtenHref = useRef(stockGapsHref(initial));
    useEffect(() => {
        if (writtenHref.current === viewHref) return;
        writtenHref.current = viewHref;
        router.setParams(stockGapsParams(view) as never);
    });

    const openRecord = (row: ConsumptionException) => {
        setViewingId(row.id);
        setFixed(false);
    };
    const closeRecord = () => {
        setViewingId(null);
        setFixed(false);
    };

    /** A filter change is a navigation: the page, and any record held in the window, go with it. */
    const refilter = () => {
        closeRecord();
    };

    const fixable = (row: ConsumptionException) =>
        canViewRecipes && !row.resolved && canFixInRecipe(row);

    /** Out to the recipe, carrying this view with the gap open, so Back returns to it. */
    const openFix = (row: ConsumptionException) => {
        router.push(
            recipeFixHref(
                row,
                stockGapsHref({ status, from: view.from, page, gap: row.id }),
            ) as never,
        );
    };

    /** A refused write said nothing at all — a 500 on Retry left the row exactly as it was. */
    const showFailure = (error: unknown) => {
        toast.show({
            testID: 'kitchen-exception-action-failed-toast',
            tone: 'danger',
            message: toFailure(error)?.message ?? t('kitchen:ops.exceptions.actionFailedToast'),
        });
    };

    const runRetry = (row: ConsumptionException) => {
        setPendingId(row.id);
        retry.mutate(row.id, {
            // A retry that still cannot deduct leaves the row where it was, so say which it was.
            onSuccess: (result) => {
                toast.show({
                    testID: 'kitchen-exception-retried-toast',
                    tone: result.resolved ? 'success' : 'warning',
                    message: t(
                        result.resolved
                            ? 'kitchen:ops.exceptions.retryDeductedToast'
                            : 'kitchen:ops.exceptions.retryStillOpenToast',
                        { order: orderLabel(row) },
                    ),
                });
            },
            onError: showFailure,
            onSettled: () => {
                setPendingId(null);
            },
        });
    };

    const confirmResolve = () => {
        if (resolving === null) return;
        const row = resolving;
        setPendingId(row.id);
        resolve.mutate(
            { exceptionId: row.id },
            {
                onSuccess: () => {
                    setResolving(null);
                    closeRecord();
                    toast.show({
                        testID: 'kitchen-exception-resolved-toast',
                        tone: 'success',
                        message: t('kitchen:ops.exceptions.resolvedToast', {
                            order: row.orderNumber ?? t('kitchen:ops.exceptions.unknownOrder'),
                        }),
                    });
                },
                onError: showFailure,
                onSettled: () => {
                    setPendingId(null);
                },
            },
        );
    };

    const orderLabel = (row: ConsumptionException) =>
        row.orderNumber ?? t('kitchen:ops.exceptions.unknownOrder');
    const itemLabel = (row: ConsumptionException) =>
        row.itemNameEn ?? t('kitchen:ops.exceptions.unknownItem');
    /**
     * The sold item, and the ingredient the gap is about when it names one. A product sold as its
     * own ingredient (a dip, a sauce) would read "Barbecue Dip · Barbecue Dip", so the same name
     * twice is said once.
     */
    const itemCellLabel = (row: ConsumptionException) =>
        row.ingredientNameEn === null ||
        row.ingredientNameEn.trim().toLowerCase() === itemLabel(row).trim().toLowerCase()
            ? itemLabel(row)
            : `${itemLabel(row)} · ${row.ingredientNameEn}`;
    const raisedLabel = (row: ConsumptionException) =>
        row.createdAt === null
            ? t('kitchen:list.noValue')
            : formatter.formatDate(row.createdAt, { dateStyle: 'medium' });

    const columns: readonly ControlledColumn<
        ConsumptionException,
        CatalogueColumn<ConsumptionException>
    >[] = [
        {
            key: 'order',
            role: 'title',
            value: (row) => orderLabel(row),
            label: t('kitchen:ops.exceptions.columnOrder'),
            width: 180,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(orderLabel(left), orderLabel(right), direction),
            render: (row) => (
                <View className="min-w-0 flex-col py-1">
                    <Text
                        variant="mono"
                        className="font-medium"
                        testID={`kitchen-exception-${row.id}-order`}
                    >
                        {orderLabel(row)}
                    </Text>
                    <Text
                        variant="caption"
                        tone="secondary"
                        numberOfLines={2}
                        testID={`kitchen-exception-${row.id}-item`}
                    >
                        {itemCellLabel(row)}
                    </Text>
                </View>
            ),
        },
        {
            key: 'branch',
            label: t('kitchen:ops.exceptions.columnBranch'),
            width: 130,
            priority: 60,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.branchName ?? ''))]
                        .filter((name) => name !== '')
                        .map((name) => ({ key: name, label: name })),
                match: (row, value) => row.branchName === value,
            },
            render: (row) => (
                <Text tone="secondary" numberOfLines={1}>
                    {row.branchName ?? t('kitchen:list.noValue')}
                </Text>
            ),
        },
        {
            key: 'reason',
            role: 'meta',
            label: t('kitchen:ops.exceptions.columnReason'),
            width: 220,
            priority: 90,
            filter: {
                values: (loaded) =>
                    [...new Set(loaded.map((row) => row.reasonCode))].map((code) => ({
                        key: code,
                        label: t(`kitchen:ops.exceptions.reasons.${code}`),
                    })),
                match: (row, value) => row.reasonCode === value,
            },
            render: (row) => (
                <Text testID={`kitchen-exception-${row.id}-reason`}>
                    {t(`kitchen:ops.exceptions.reasons.${row.reasonCode}`)}
                </Text>
            ),
        },
        {
            key: 'raised',
            label: t('kitchen:ops.exceptions.columnRaised'),
            width: 120,
            priority: 40,
            sort: (left, right, direction) =>
                compareText(left.createdAt ?? '', right.createdAt ?? '', direction),
            render: (row) => (
                <Text variant="mono" tone="secondary">
                    {raisedLabel(row)}
                </Text>
            ),
        },
        {
            key: 'status',
            role: 'status',
            label: t('kitchen:ops.exceptions.columnStatus'),
            // The badge and up to three actions — Fix in recipe, Retry, Accept gap — on one line.
            width: 340,
            priority: 95,
            /*
             * The toolbar's status cut, offered again where the column is: the same state, so the
             * two never disagree, and sent with the request as `resolved` — the list is cursor-paged,
             * and narrowing the page in hand would misreport every page after it.
             */
            filter: {
                values: () =>
                    (
                        [
                            ['unresolved', 'kitchen:ops.exceptions.filterUnresolved'],
                            ['resolved', 'kitchen:ops.exceptions.filterResolved'],
                        ] as const
                    ).map(([key, labelKey]) => ({ key, label: t(labelKey) })),
                external: {
                    value: status === 'all' ? null : status,
                    onChange: (next) => {
                        setStatus(next === 'resolved' || next === 'unresolved' ? next : 'all');
                        refilter();
                    },
                },
            },
            render: (row) => (
                <View className="flex-row flex-wrap items-center gap-1.5">
                    {row.resolved ? (
                        <Badge
                            testID={`kitchen-exception-${row.id}-resolved`}
                            tone="success"
                            label={t('kitchen:ops.exceptions.resolvedBadge')}
                        />
                    ) : (
                        <Badge
                            testID={`kitchen-exception-${row.id}-open`}
                            tone="danger"
                            label={t('kitchen:ops.exceptions.openBadge')}
                        />
                    )}
                    <ExceptionRowActions
                        row={row}
                        pendingId={pendingId}
                        onFix={fixable(row) ? openFix : undefined}
                        onRetry={canManage ? runRetry : undefined}
                        onResolve={canManage ? setResolving : undefined}
                    />
                </View>
            ),
        },
    ];

    const controls = useColumnControls(rows, columns, 'kitchen-consumption-exceptions-table');
    const failure = toFailure(exceptions.error);

    if (viewing !== null) {
        const retryFromRecord = () => {
            const row = viewing;
            closeRecord();
            runRetry(row);
        };
        // The fix leads until it is published; then Retry is the one step left.
        const leadWithFix = fixable(viewing) && !fixed;
        return (
            <RecordViewPage
                testID="kitchen-consumption-exceptions-window"
                onBack={closeRecord}
                title={t('kitchen:ops.exceptions.window.title', { order: orderLabel(viewing) })}
                kind={t('kitchen:ops.exceptions.window.kind')}
                status={
                    viewing.resolved
                        ? { label: t('kitchen:ops.exceptions.resolvedBadge'), tone: 'success' }
                        : { label: t('kitchen:ops.exceptions.openBadge'), tone: 'danger' }
                }
                fields={[
                    {
                        key: 'item',
                        label: t('kitchen:ops.exceptions.window.fieldItem'),
                        value: itemLabel(viewing),
                    },
                    ...(viewing.ingredientNameEn === null
                        ? []
                        : [
                              {
                                  key: 'ingredient',
                                  label: t('kitchen:ops.exceptions.window.fieldIngredient'),
                                  value: viewing.ingredientNameEn,
                              },
                          ]),
                    {
                        key: 'branch',
                        label: t('kitchen:ops.exceptions.columnBranch'),
                        value: viewing.branchName ?? t('kitchen:list.noValue'),
                    },
                    {
                        key: 'reason',
                        label: t('kitchen:ops.exceptions.columnReason'),
                        value: t(`kitchen:ops.exceptions.reasons.${viewing.reasonCode}`),
                    },
                    {
                        key: 'raised',
                        label: t('kitchen:ops.exceptions.columnRaised'),
                        value: raisedLabel(viewing),
                        mono: true,
                    },
                    ...(viewing.detail === null || HAS_UUID.test(viewing.detail)
                        ? []
                        : [
                              {
                                  key: 'detail',
                                  label: t('kitchen:ops.exceptions.window.fieldDetail'),
                                  value: viewing.detail,
                              },
                          ]),
                    ...(viewing.resolutionNote === null
                        ? []
                        : [
                              {
                                  key: 'resolutionNote',
                                  label: t('kitchen:ops.exceptions.window.fieldResolutionNote'),
                                  value: viewing.resolutionNote,
                              },
                          ]),
                    {
                        key: 'money',
                        label: t('kitchen:ops.exceptions.window.fieldMoney'),
                        value: t('kitchen:ops.exceptions.window.moneyValue'),
                    },
                ]}
                /*
                 * Fix in recipe leads, with Retry under it. Both are drawn here rather than as the
                 * page's `primaryAction`, which the status card puts *below* its content — the
                 * secondary would sit above the step it follows.
                 */
                primaryAction={
                    leadWithFix || viewing.resolved || !canManage
                        ? undefined
                        : {
                              label: t('kitchen:ops.exceptions.window.retry'),
                              icon: 'refresh',
                              onPress: retryFromRecord,
                          }
                }
                statusContent={
                    leadWithFix ? (
                        <Stack space="xs">
                            <Button
                                testID="kitchen-consumption-exceptions-window-fix"
                                size="sm"
                                block
                                label={t('kitchen:ops.exceptions.fixInRecipe')}
                                iconStart={<Icon name="pen" size="sm" />}
                                onPress={() => {
                                    openFix(viewing);
                                }}
                            />
                            {canManage ? (
                                <Button
                                    testID="kitchen-consumption-exceptions-window-retry"
                                    variant="secondary"
                                    size="sm"
                                    block
                                    label={t('kitchen:ops.exceptions.window.retry')}
                                    iconStart={<Icon name="refresh" size="sm" />}
                                    disabled={pendingId !== null}
                                    onPress={retryFromRecord}
                                />
                            ) : null}
                        </Stack>
                    ) : undefined
                }
            />
        );
    }

    return (
        <Cascade space="md" testID="kitchen-consumption-exceptions-screen">
            {failure !== null ? null : (
                <CatalogueStatCards
                    testID="kitchen-consumption-exceptions-summary"
                    pending={exceptions.isPending || totals.isPending}
                    cards={[
                        {
                            key: 'shown',
                            label: t('kitchen:list.statShown'),
                            value: formatter.formatNumber(shownSoFar),
                            unit: t('kitchen:list.statShownUnit', { total: total ?? shownSoFar }),
                            caption:
                                status === 'all' && from === ''
                                    ? t('kitchen:list.statShownUnfiltered')
                                    : t('kitchen:list.statShownFiltered'),
                            mark: 'list',
                            tone: 'brand',
                            onPress: () => {
                                setStatus('all');
                                refilter();
                            },
                            accessibilityLabel: t('kitchen:ops.exceptions.filterAll'),
                        },
                        {
                            key: 'unresolved',
                            label: t('kitchen:ops.exceptions.filterUnresolved'),
                            value:
                                unresolved === null ? EM_DASH : formatter.formatNumber(unresolved),
                            unit: t('kitchen:ops.exceptions.statUnit'),
                            caption: t('kitchen:ops.exceptions.statUnresolvedCaption'),
                            mark: 'alert',
                            tone: unresolved === null || unresolved === 0 ? 'default' : 'danger',
                            onPress: () => {
                                setStatus('unresolved');
                                refilter();
                            },
                            accessibilityLabel: t('kitchen:ops.exceptions.filterUnresolved'),
                        },
                        {
                            key: 'resolved',
                            label: t('kitchen:ops.exceptions.filterResolved'),
                            value: resolved === null ? EM_DASH : formatter.formatNumber(resolved),
                            unit: t('kitchen:ops.exceptions.statUnit'),
                            caption: t('kitchen:ops.exceptions.statResolvedCaption'),
                            mark: 'circleCheck',
                            tone: 'default',
                            onPress: () => {
                                setStatus('resolved');
                                refilter();
                            },
                            accessibilityLabel: t('kitchen:ops.exceptions.filterResolved'),
                        },
                    ]}
                />
            )}
            <View
                testID="kitchen-consumption-exceptions-toolbar"
                className="z-10 min-h-control-sm flex-row flex-wrap items-center gap-snug"
            >
                <SegmentedControl<StockGapStatus>
                    testID="kitchen-exceptions-filter-status"
                    label={t('kitchen:ops.exceptions.filterStatus')}
                    value={status}
                    onChange={(next) => {
                        setStatus(next);
                        refilter();
                    }}
                    items={(
                        [
                            ['all', 'kitchen:ops.exceptions.filterAll'],
                            ['unresolved', 'kitchen:ops.exceptions.filterUnresolved'],
                            ['resolved', 'kitchen:ops.exceptions.filterResolved'],
                        ] as const
                    ).map(([value, labelKey]) => ({
                        value,
                        label: t(labelKey),
                        testID: `kitchen-exceptions-filter-status-${value}`,
                    }))}
                />
                <DatePickerButton
                    testID="kitchen-exceptions-filter-from"
                    label={t('kitchen:ops.exceptions.filterFrom')}
                    value={from}
                    onChange={(next) => {
                        setFrom(next);
                        refilter();
                    }}
                />
            </View>

            {exceptions.isPending ? (
                <TableSkeleton testID="kitchen-consumption-exceptions-loading" rows={8} />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-consumption-exceptions-error"
                    failure={failure}
                    onRetry={() => {
                        void exceptions.refetch();
                    }}
                    retrying={exceptions.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-consumption-exceptions-empty"
                    title={t('kitchen:ops.exceptions.emptyTitle')}
                    body={t('kitchen:ops.exceptions.emptyBody')}
                />
            ) : (
                <View className="flex-col gap-2.5">
                    <WithColumnPicker picker={controls.picker}>
                        <CatalogueList<ConsumptionException>
                            testID="kitchen-consumption-exceptions-table"
                            label={t('kitchen:ops.exceptions.title')}
                            columns={controls.columns}
                            rows={controls.rows}
                            rowKey={(row) => row.id}
                            onRowPress={openRecord}
                            rowActionsLabel={t('kitchen:list.rowActions')}
                        />
                    </WithColumnPicker>
                    <CataloguePager
                        testID="kitchen-consumption-exceptions-pagination"
                        page={page}
                        totalPages={totalPages}
                        onPageChange={(next) => {
                            setPage(next);
                            closeRecord();
                        }}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </View>
            )}

            <Dialog
                testID="kitchen-exception-resolve-dialog"
                open={resolving !== null}
                onClose={() => {
                    setResolving(null);
                }}
                title={t('kitchen:ops.exceptions.resolveTitle')}
                description={t('kitchen:ops.exceptions.resolveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-exception-resolve-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setResolving(null);
                            }}
                        />
                        <Button
                            testID="kitchen-exception-resolve-confirm"
                            variant="danger"
                            label={t('kitchen:ops.exceptions.resolveConfirm')}
                            loading={resolve.isPending}
                            onPress={confirmResolve}
                        />
                    </>
                }
            />
        </Cascade>
    );
}
