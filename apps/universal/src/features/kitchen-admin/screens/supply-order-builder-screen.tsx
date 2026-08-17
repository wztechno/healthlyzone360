import type {
    OrderProposalItem,
    StockItem,
    Supplier,
    SupplierOption,
} from '@healthy360/api-client/contracts';
import type { StockItemId, SupplierId } from '@healthy360/domain-types';
import {
    Accordion,
    Badge,
    Button,
    Card,
    Checkbox,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { AccordionItem, SelectOption, TableColumn } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useCreatePurchaseOrdersMutation,
    useOrderProposalQuery,
    useStockItemsQuery,
    useSuppliersQuery,
    useUpsertSupplierLinkMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { INVENTORY_ORDER_SUPPLIES_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { stockItemLabel, supplyOrderGroupTestId, supplyOrderRowTestId } from '../ops-format.ts';
import {
    buildGroups,
    initialChoice,
    initialChoices,
    readQuantity,
    supplierChoices,
    toBatchPayload,
} from '../supply-order-model.ts';
import type {
    QuantityIssue,
    SupplyOrderChoices,
    SupplyOrderRowChoice,
    SupplyOrderSupplier,
} from '../supply-order-model.ts';

/**
 * `/kitchen/supply-orders/new` — the supply-order builder (SUP3).
 *
 * One screen, four regions, and the order of them is the order of the job: **what is short**, **what
 * nobody can supply**, **what else you want**, and **what you are about to ask for**.
 *
 * ## Server order, never re-sorted
 *
 * Rows arrive out of stock first, then low, then requested, each group by item name. The screen
 * renders that order and has no sort control, on the same terms as the stock-item picker: the server
 * decided what matters most and a client sort would silently overrule it. Splitting the list into
 * regions A and B is a *partition* of that order, not a re-ordering — each region keeps the
 * sequence the rows came in.
 *
 * ## The quantity box, and why it is a text field
 *
 * `TextInputField` with `keyboardType="decimal-pad"`, never `NumberStepper`: the stepper's
 * clamp-to-step destroys 0.125, and a kitchen ordering an eighth of a kilo of saffron means it.
 * Values stay strings from the box to the payload — see `supply-order-model.ts`.
 *
 * A row whose par could not be computed opens **empty**, and an empty box is not an error. It is the
 * designed state for every shelf with no par, and painting forty of them red would make the screen
 * unusable exactly when it is most needed. Blank and zero exclude the row quietly and are counted in
 * the summary; a negative, a fifth decimal or a typed word is a real error against that row.
 *
 * ## The supplier cell has three states, and they are genuinely different
 *
 * 1. **A suggestion** — the preferred supplier, or the only one. Named, badged and changeable.
 * 2. **Options but no suggestion** — two or more candidates and no preference recorded. The system
 *    declines to guess, so the cell is a picker with a warning badge asking for a choice.
 * 3. **Nothing to choose from** — the row moves to region B, where the picker is the *whole supplier
 *    book* rather than this item's links.
 *
 * State 2 and state 3 look similar and are not: one is *choose between these*, the other is *this
 * shelf has no supplier on file*. Collapsing them would hide the second inside the first.
 *
 * ## Remembering a supplier is its own write
 *
 * Region B offers **Remember this supplier for this item**, checked by default because a person
 * assigning a supplier to an unlinked shelf almost always wants the link. It fires the link upsert
 * **standalone**, the moment a supplier is chosen — never as a side effect of creating an order.
 * §4 is explicit: order creation never changes supplier links implicitly, and a link written by a
 * commit would be a configuration change nobody asked for hiding inside a purchase.
 *
 * ## Refresh is confirmed only when there is something to lose
 *
 * The proposal is a live read of the shelves and goes stale while somebody types. Refresh is offered
 * with the time of the last read beside it, and it asks first **only when edits exist** — a
 * confirmation on an untouched screen is a dialog that teaches people to dismiss dialogs.
 *
 * ## The commit bar, and why the thing confirmed is the thing sent
 *
 * Below the preview, and only there: a person reads what they are about to ask for and then presses
 * the one button under it. The payload is `toBatchPayload(plan)` — the same pure function that built
 * the accordion above — so the grouping somebody looked at and the request that leaves the device
 * are provably one object rather than two views that agree by inspection.
 *
 * The confirmation states the two numbers and the rows being left behind, and the two kinds of
 * "left behind" are named separately (§4): a row with a quantity and nobody to buy it from is a job
 * left undone, and a row somebody switched off is not. Lumping them together would let a person tick
 * past four shelves they still need.
 *
 * **The batch is atomic**, so the failure message says so. There is no partial state to explain and
 * no half-created list to reconcile — either every draft exists or none does, and "Nothing was
 * saved" is the whole truth rather than a reassurance.
 */

const EM_DASH = '—';

/** Which issues the row paints red. Blank and zero are exclusions and say so in the summary. */
const ERROR_ISSUES: ReadonlySet<QuantityIssue> = new Set<QuantityIssue>([
    'negative',
    'notANumber',
    'tooPrecise',
    'tooLarge',
]);

export function SupplyOrderBuilderScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [INVENTORY_ORDER_SUPPLIES_PERMISSION] }}
            testID="kitchen-supply-order-builder"
        >
            <SupplyOrderBuilder />
        </Gate>
    );
}

function SupplyOrderBuilder() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();
    const access = useAccessState();

    const branchId = access.branch?.id ?? null;

    const [requestedIds, setRequestedIds] = useState<readonly StockItemId[]>([]);
    /** Only the rows the person has touched. Untouched rows are answered by the server's defaults. */
    const [edits, setEdits] = useState<SupplyOrderChoices>({});
    const [touched, setTouched] = useState(false);
    const [remember, setRemember] = useState<Readonly<Record<string, boolean>>>({});
    const [confirmingRefresh, setConfirmingRefresh] = useState(false);
    const [confirmingCreate, setConfirmingCreate] = useState(false);
    /** Dialog-level, not toast-level: the batch failed, so the dialog stays open to be retried. */
    const [createFailed, setCreateFailed] = useState(false);

    const proposal = useOrderProposalQuery(branchId, requestedIds);
    // The whole live book, for region B's picker: a shelf with no links may still be assigned any
    // active supplier, and this is the only place that set comes from.
    const suppliers = useSuppliersQuery();
    const stockItems = useStockItemsQuery();
    const linkSupplier = useUpsertSupplierLinkMutation();
    const createOrders = useCreatePurchaseOrdersMutation();

    const rows = useMemo(() => proposal.data?.items ?? [], [proposal.data]);

    /**
     * The state every row is actually in: the server's opening position, overwritten by whatever
     * the person has typed into the rows they have touched.
     *
     * **Derived during render, never synchronised in an effect.** `edits` holds only the rows
     * somebody changed, so a fresh proposal — from Refresh or from adding an item — simply produces
     * new defaults for the rows it brought while the typed ones keep their values. An effect that
     * copied the server's answer into state would have to re-run on every fetch, and the frame
     * between the answer arriving and the copy landing is where a table renders the wrong numbers.
     */
    const effective = useMemo(() => initialChoices(rows, edits), [rows, edits]);

    const directory: readonly SupplyOrderSupplier[] = useMemo(
        () =>
            (suppliers.data ?? []).map((supplier: Supplier) => ({
                id: supplier.id,
                code: supplier.code,
                nameEn: supplier.name.en,
                nameAr: supplier.name.ar === '' ? null : supplier.name.ar,
            })),
        [suppliers.data],
    );

    const plan = useMemo(
        () => buildGroups(rows, effective, directory),
        [rows, effective, directory],
    );

    const assigned = rows.filter((row: OrderProposalItem) => row.unassignedReason === null);
    const unlinked = rows.filter((row: OrderProposalItem) => row.unassignedReason !== null);

    /**
     * One number for the bar, two for the dialog.
     *
     * The bar says how many rows will not be ordered; the confirmation is where the two reasons are
     * told apart, because that is the moment somebody can still do something about either.
     */
    const leftBehind = plan.unassigned.length + plan.excluded.length;

    function update(row: OrderProposalItem, patch: Partial<SupplyOrderRowChoice>): void {
        const key = String(row.stockItemId);
        setTouched(true);
        // Based on the row's *effective* state rather than on `edits`, so the first edit to an
        // untouched row keeps the suggestion beside the field being changed instead of blanking it.
        setEdits((previous) => ({
            ...previous,
            [key]: { ...(previous[key] ?? initialChoice(row)), ...patch },
        }));
    }

    function chooseSupplier(row: OrderProposalItem, supplierId: SupplierId): void {
        update(row, { supplierId });

        // Standalone, and only when asked for. Creating an order never writes a link.
        if (row.unassignedReason !== null && (remember[String(row.stockItemId)] ?? true)) {
            linkSupplier.mutate({ supplierId, stockItemId: row.stockItemId });
        }
    }

    function refresh(): void {
        setConfirmingRefresh(false);
        setTouched(false);
        void proposal.refetch();
    }

    /**
     * The commit. `toBatchPayload(plan)` is the object the preview above was built from, so what a
     * person confirmed and what leaves the device cannot drift.
     *
     * On success the builder is done and steps aside: the landing page is where the new orders live,
     * and leaving somebody on a builder whose rows have just been ordered would invite a second
     * batch. `replace` rather than `push`, so Back does not return to a stale form.
     *
     * On failure the dialog stays open with a danger line inside it. The batch is atomic — nothing
     * was saved — so the honest offer is "try again" rather than an explanation of partial state.
     */
    function createDrafts(): void {
        createOrders.mutate(toBatchPayload(plan), {
            onSuccess: (created) => {
                setConfirmingCreate(false);
                setCreateFailed(false);
                router.replace('/kitchen/supply-orders' as never);
                toast.show({
                    testID: 'kitchen-supply-order-created-toast',
                    tone: 'success',
                    message: t('kitchen:ops.supplyOrders.createdToast', {
                        count: created.length,
                        numbers: created.map((order) => order.number).join(', '),
                    }),
                });
            },
            onError: () => {
                setCreateFailed(true);
            },
        });
    }

    const failure = toFailure(proposal.error);
    const readAt = proposal.dataUpdatedAt === 0 ? null : new Date(proposal.dataUpdatedAt);

    /** Every column but the supplier cell, which the two regions render differently. */
    function baseColumns(): readonly TableColumn<OrderProposalItem>[] {
        return [
            {
                key: 'item',
                header: t('kitchen:ops.supplyOrders.columnItem'),
                rowHeader: true,
                flex: 2,
                render: (row) => {
                    const testID = supplyOrderRowTestId(String(row.stockItemId));
                    return (
                        <Stack space="none">
                            <Text variant="bodyStrong" testID={`${testID}-name`}>
                                {row.itemNameEn}
                            </Text>
                            <Text variant="caption" tone="secondary" testID={`${testID}-code`}>
                                {row.itemCode}
                            </Text>
                        </Stack>
                    );
                },
            },
            {
                key: 'onHand',
                header: t('kitchen:ops.supplyOrders.columnOnHand'),
                flex: 2,
                render: (row) => {
                    const testID = supplyOrderRowTestId(String(row.stockItemId));
                    return (
                        <Inline space="xs" align="center" wrap>
                            <Text testID={`${testID}-on-hand`}>
                                {`${formatter.formatNumber(Number(row.quantityOnHand))} ${row.unitCode}`}
                            </Text>
                            {row.isOutOfStock ? (
                                <Badge
                                    testID={`${testID}-out`}
                                    tone="danger"
                                    label={t('kitchen:ops.supplyOrders.outBadge')}
                                />
                            ) : row.isLow ? (
                                <Badge
                                    testID={`${testID}-low`}
                                    tone="warning"
                                    label={t('kitchen:ops.supplyOrders.lowBadge')}
                                />
                            ) : null}
                        </Inline>
                    );
                },
            },
            {
                key: 'levels',
                // One column for both numbers: they are read together — "reorder at 5, fill to 20" —
                // and two columns of mostly em dashes would be two columns of nothing.
                header: t('kitchen:ops.supplyOrders.columnLevels'),
                numeric: true,
                render: (row) => (
                    <Text
                        tone="secondary"
                        testID={`${supplyOrderRowTestId(String(row.stockItemId))}-levels`}
                    >
                        {`${row.reorderThreshold === null ? EM_DASH : formatter.formatNumber(Number(row.reorderThreshold))} / ${
                            row.parLevel === null
                                ? EM_DASH
                                : formatter.formatNumber(Number(row.parLevel))
                        }`}
                    </Text>
                ),
            },
            {
                key: 'quantity',
                header: t('kitchen:ops.supplyOrders.columnQuantity'),
                flex: 2,
                render: (row) => {
                    const key = String(row.stockItemId);
                    const testID = supplyOrderRowTestId(key);
                    const choice = effective[key];
                    const value = choice?.quantity ?? '';
                    const reading = readQuantity(value);
                    const showError =
                        reading.issue !== null && ERROR_ISSUES.has(reading.issue) && value !== '';

                    return (
                        <Inline space="xs" align="center" wrap>
                            <TextInputField
                                testID={`${testID}-quantity`}
                                /*
                                 * Labelled with the item's own name, not a shared "Order quantity".
                                 * Forty inputs sharing one accessible name is a form a screen-reader
                                 * user cannot navigate, and the duplication is invisible by eye.
                                 */
                                label={t('kitchen:ops.supplyOrders.quantityLabel', {
                                    item: row.itemNameEn,
                                })}
                                keyboardType="decimal-pad"
                                value={value}
                                // An em dash placeholder rather than "0": the row has no honest
                                // suggestion and a zero in the box would read as one.
                                placeholder={
                                    row.suggestedQuantity === null
                                        ? t('kitchen:ops.supplyOrders.quantityPlaceholder')
                                        : undefined
                                }
                                error={
                                    showError && reading.issue !== null
                                        ? t(
                                              `kitchen:ops.supplyOrders.quantityIssue.${reading.issue}`,
                                          )
                                        : undefined
                                }
                                disabled={!(choice?.ordering ?? true)}
                                onChangeText={(next) => {
                                    update(row, { quantity: next });
                                }}
                            />
                            <Text tone="secondary" testID={`${testID}-unit`}>
                                {row.unitCode}
                            </Text>
                        </Inline>
                    );
                },
            },
        ];
    }

    function orderingColumn(): TableColumn<OrderProposalItem> {
        return {
            key: 'ordering',
            header: t('kitchen:ops.supplyOrders.columnOrdering'),
            render: (row) => {
                const key = String(row.stockItemId);
                const ordering = effective[key]?.ordering ?? true;

                return (
                    <Button
                        testID={`${supplyOrderRowTestId(key)}-toggle`}
                        variant="ghost"
                        size="sm"
                        label={
                            ordering
                                ? t('kitchen:ops.supplyOrders.notOrdering')
                                : t('kitchen:ops.supplyOrders.order')
                        }
                        onPress={() => {
                            // The typed quantity is kept, not cleared: switching a row off and back
                            // on must not cost somebody the number they worked out.
                            update(row, { ordering: !ordering });
                        }}
                    />
                );
            },
        };
    }

    const assignedColumns: readonly TableColumn<OrderProposalItem>[] = [
        ...baseColumns(),
        {
            key: 'supplier',
            header: t('kitchen:ops.supplyOrders.columnFrom'),
            flex: 2,
            render: (row) => {
                const key = String(row.stockItemId);
                const testID = supplyOrderRowTestId(key);
                const chosen = effective[key]?.supplierId ?? null;
                const options: readonly SelectOption[] = row.supplierOptions.map(
                    (option: SupplierOption) => ({
                        value: String(option.id),
                        label: option.nameEn,
                        description: option.isPreferred
                            ? t('kitchen:ops.supplyOrders.preferredBadge')
                            : option.code,
                    }),
                );
                const current = row.supplierOptions.find(
                    (option: SupplierOption) => String(option.id) === chosen,
                );

                return (
                    <Stack space="xs">
                        {current === undefined ? (
                            <Badge
                                testID={`${testID}-choose-supplier`}
                                tone="warning"
                                label={t('kitchen:ops.supplyOrders.chooseSupplier')}
                            />
                        ) : (
                            <Inline space="xs" align="center" wrap>
                                <Text testID={`${testID}-supplier`}>{current.nameEn}</Text>
                                {current.isPreferred ? (
                                    <Badge
                                        testID={`${testID}-preferred`}
                                        tone="info"
                                        label={t('kitchen:ops.supplyOrders.preferredBadge')}
                                    />
                                ) : null}
                            </Inline>
                        )}
                        <Select
                            testID={`${testID}-supplier-select`}
                            label={t('kitchen:ops.supplyOrders.supplierLabel', {
                                item: row.itemNameEn,
                            })}
                            options={options}
                            value={chosen === null ? null : String(chosen)}
                            placeholder={t('kitchen:ops.supplyOrders.supplierPlaceholder')}
                            onChange={(value) => {
                                chooseSupplier(row, value as SupplierId);
                            }}
                        />
                    </Stack>
                );
            },
        },
        orderingColumn(),
    ];

    const unlinkedColumns: readonly TableColumn<OrderProposalItem>[] = [
        ...baseColumns(),
        {
            key: 'supplier',
            header: t('kitchen:ops.supplyOrders.columnFrom'),
            flex: 3,
            render: (row) => {
                const key = String(row.stockItemId);
                const testID = supplyOrderRowTestId(key);
                const chosen = effective[key]?.supplierId ?? null;
                const options: readonly SelectOption[] = supplierChoices(row, directory).map(
                    (supplier) => ({
                        value: String(supplier.id),
                        label: supplier.nameEn,
                        description: supplier.code,
                    }),
                );

                return (
                    <Stack space="xs">
                        {/*
                         * The two reasons get different words because they have different fixes: a
                         * shelf nobody was ever linked to needs a supplier; a shelf whose suppliers
                         * are all archived needs one restored, or a different one linked.
                         */}
                        <Text variant="caption" tone="secondary" testID={`${testID}-reason`}>
                            {row.unassignedReason === 'suppliersArchived'
                                ? t('kitchen:ops.supplyOrders.reasonArchived')
                                : t('kitchen:ops.supplyOrders.reasonNoSupplier')}
                        </Text>
                        <Select
                            testID={`${testID}-supplier-select`}
                            label={t('kitchen:ops.supplyOrders.supplierLabel', {
                                item: row.itemNameEn,
                            })}
                            options={options}
                            searchable
                            value={chosen === null ? null : String(chosen)}
                            placeholder={t('kitchen:ops.supplyOrders.supplierPlaceholder')}
                            onChange={(value) => {
                                chooseSupplier(row, value as SupplierId);
                            }}
                        />
                        <Checkbox
                            testID={`${testID}-remember`}
                            checked={remember[key] ?? true}
                            label={t('kitchen:ops.supplyOrders.rememberLink')}
                            onChange={(checked) => {
                                setRemember((previous) => ({ ...previous, [key]: checked }));
                            }}
                        />
                    </Stack>
                );
            },
        },
        orderingColumn(),
    ];

    /** Every shelf, for **Add something else** — server ranking, never re-sorted. */
    const addOptions: readonly SelectOption[] = (stockItems.data ?? [])
        .filter(
            (item: StockItem) =>
                !rows.some((row: OrderProposalItem) => String(row.stockItemId) === String(item.id)),
        )
        .map((item: StockItem) => ({
            value: String(item.id),
            label: stockItemLabel(item),
            description: item.unitCode,
        }));

    const groupItems: readonly AccordionItem[] = plan.groups.map((group) => ({
        key: String(group.supplier.id),
        title: t('kitchen:ops.supplyOrders.groupSummary', {
            supplier: displayName(
                { en: group.supplier.nameEn, ar: group.supplier.nameAr ?? '' },
                locale,
            ).value,
            count: group.lines.length,
        }),
        testID: supplyOrderGroupTestId(String(group.supplier.id)),
        children: (
            <Stack space="xs">
                {group.lines.map((line) => (
                    <Inline
                        key={String(line.row.stockItemId)}
                        space="sm"
                        justify="between"
                        wrap
                        testID={`${supplyOrderGroupTestId(String(group.supplier.id))}-line-${String(line.row.stockItemId)}`}
                    >
                        <Text>{line.row.itemNameEn}</Text>
                        <Text tone="secondary">
                            {`${formatter.formatNumber(Number(line.quantity))} ${line.row.unitCode}`}
                        </Text>
                    </Inline>
                ))}
            </Stack>
        ),
    }));

    return (
        <Stack space="lg" testID="kitchen-supply-order-builder-screen">
            <Inline space="sm" align="end" justify="between" wrap>
                <Stack space="xs">
                    <Heading level={1} testID="kitchen-supply-order-builder-title">
                        {t('kitchen:ops.supplyOrders.builderTitle')}
                    </Heading>
                    <Text variant="caption" tone="secondary" testID="kitchen-supply-order-read-at">
                        {readAt === null
                            ? t('kitchen:ops.supplyOrders.readAtPending')
                            : t('kitchen:ops.supplyOrders.readAt', {
                                  time: formatter.formatDate(readAt, {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                  }),
                              })}
                    </Text>
                </Stack>
                <Button
                    testID="kitchen-supply-order-refresh"
                    variant="ghost"
                    label={t('kitchen:ops.supplyOrders.refresh')}
                    loading={proposal.isFetching}
                    onPress={() => {
                        if (touched) {
                            setConfirmingRefresh(true);
                            return;
                        }
                        refresh();
                    }}
                />
            </Inline>

            {branchId === null ? (
                <EmptyState
                    testID="kitchen-supply-order-builder-branch-required"
                    title={t('kitchen:ops.supplyOrders.branchRequiredTitle')}
                    body={t('kitchen:ops.supplyOrders.branchRequiredBody')}
                />
            ) : proposal.isPending ? (
                <Stack space="sm" testID="kitchen-supply-order-builder-loading">
                    {Array.from({ length: 4 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Skeleton
                                testID={`kitchen-supply-order-skeleton-${String(index + 1)}`}
                                heightClassName="h-5"
                            />
                        </Card>
                    ))}
                </Stack>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-supply-order-builder-error"
                    failure={failure}
                    onRetry={refresh}
                    retrying={proposal.isFetching}
                />
            ) : (
                <>
                    {assigned.length === 0 ? (
                        <EmptyState
                            testID="kitchen-supply-order-builder-empty"
                            icon="success"
                            title={t('kitchen:ops.supplyOrders.nothingNeededTitle')}
                            body={t('kitchen:ops.supplyOrders.builderEmptyBody')}
                        />
                    ) : (
                        <Table<OrderProposalItem>
                            testID="kitchen-supply-order-rows"
                            caption={t('kitchen:ops.supplyOrders.builderCaption')}
                            captionHidden
                            columns={assignedColumns}
                            rows={assigned}
                            rowKey={(row) => String(row.stockItemId)}
                        />
                    )}

                    {unlinked.length === 0 ? null : (
                        <Stack space="sm" testID="kitchen-supply-order-unlinked">
                            <Heading level={2}>
                                {t('kitchen:ops.supplyOrders.unlinkedTitle')}
                            </Heading>
                            <Table<OrderProposalItem>
                                testID="kitchen-supply-order-unlinked-rows"
                                caption={t('kitchen:ops.supplyOrders.unlinkedCaption')}
                                captionHidden
                                columns={unlinkedColumns}
                                rows={unlinked}
                                rowKey={(row) => String(row.stockItemId)}
                            />
                            <Button
                                testID="kitchen-supply-order-add-supplier"
                                variant="ghost"
                                label={t('kitchen:ops.supplyOrders.addSupplier')}
                                onPress={() => {
                                    router.push('/kitchen/suppliers/new' as never);
                                }}
                            />
                        </Stack>
                    )}

                    <Stack space="sm" testID="kitchen-supply-order-add">
                        <Heading level={2}>{t('kitchen:ops.supplyOrders.addTitle')}</Heading>
                        <Select
                            testID="kitchen-supply-order-add-select"
                            label={t('kitchen:ops.supplyOrders.addLabel')}
                            hint={t('kitchen:ops.supplyOrders.addHint')}
                            options={addOptions}
                            searchable
                            value={null}
                            placeholder={t('kitchen:ops.supplyOrders.addPlaceholder')}
                            onChange={(value) => {
                                // Re-query rather than append a row here: the server owns what a
                                // proposal row looks like, suppliers resolved and all, so a shelf
                                // somebody typed in comes back the same shape as one that ran out.
                                setRequestedIds((previous) => [
                                    ...previous,
                                    value as unknown as StockItemId,
                                ]);
                            }}
                        />
                    </Stack>

                    <Stack space="sm" testID="kitchen-supply-order-preview">
                        <Heading level={2}>{t('kitchen:ops.supplyOrders.readyTitle')}</Heading>
                        {plan.groups.length === 0 ? (
                            <Text tone="secondary" testID="kitchen-supply-order-preview-empty">
                                {t('kitchen:ops.supplyOrders.readyEmpty')}
                            </Text>
                        ) : (
                            <Accordion
                                testID="kitchen-supply-order-groups"
                                items={groupItems}
                                multiple
                                defaultExpandedKeys={groupItems.map((item) => item.key)}
                            />
                        )}
                        {plan.unassigned.length === 0 ? null : (
                            <Text
                                tone="warning"
                                variant="caption"
                                testID="kitchen-supply-order-unassigned-warning"
                            >
                                {t('kitchen:ops.supplyOrders.unassignedCount', {
                                    count: plan.unassigned.length,
                                })}
                            </Text>
                        )}
                        {plan.excluded.length === 0 ? null : (
                            <Text
                                tone="secondary"
                                variant="caption"
                                testID="kitchen-supply-order-excluded"
                            >
                                {t('kitchen:ops.supplyOrders.excludedCount', {
                                    count: plan.excluded.length,
                                })}
                            </Text>
                        )}
                    </Stack>

                    {plan.groups.length === 0 ? null : (
                        <View
                            testID="kitchen-supply-order-commit"
                            className="flex-row flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-100 bg-surface-raised p-3 shadow-elevation-1"
                        >
                            {/*
                             * Three counts as three complete phrases rather than one interpolated
                             * sentence: each pluralises on its own number, which is the only shape
                             * that survives a six-form language.
                             */}
                            <Inline space="sm" align="center" wrap>
                                <Text
                                    variant="bodyStrong"
                                    testID="kitchen-supply-order-commit-orders"
                                >
                                    {t('kitchen:ops.supplyOrders.commitOrders', {
                                        count: plan.groups.length,
                                    })}
                                </Text>
                                <Text tone="secondary" testID="kitchen-supply-order-commit-lines">
                                    {t('kitchen:ops.supplyOrders.commitLines', {
                                        count: plan.lineCount,
                                    })}
                                </Text>
                                {leftBehind === 0 ? null : (
                                    <Text
                                        tone="secondary"
                                        testID="kitchen-supply-order-commit-left-behind"
                                    >
                                        {t('kitchen:ops.supplyOrders.commitLeftBehind', {
                                            count: leftBehind,
                                        })}
                                    </Text>
                                )}
                            </Inline>
                            <Button
                                testID="kitchen-supply-order-create"
                                label={t('kitchen:ops.supplyOrders.createDrafts', {
                                    count: plan.groups.length,
                                })}
                                loading={createOrders.isPending}
                                onPress={() => {
                                    setCreateFailed(false);
                                    setConfirmingCreate(true);
                                }}
                            />
                        </View>
                    )}
                </>
            )}

            <Dialog
                open={confirmingCreate}
                onClose={() => {
                    setConfirmingCreate(false);
                }}
                title={t('kitchen:ops.supplyOrders.createConfirmTitle')}
                description={t('kitchen:ops.supplyOrders.createConfirmBody')}
                testID="kitchen-supply-order-create-confirm"
                actions={
                    <>
                        <Button
                            testID="kitchen-supply-order-create-cancel"
                            variant="secondary"
                            label={t('kitchen:ops.supplyOrders.createCancel')}
                            onPress={() => {
                                setConfirmingCreate(false);
                            }}
                        />
                        <Button
                            testID="kitchen-supply-order-create-confirm-action"
                            label={t('kitchen:ops.supplyOrders.createConfirm', {
                                count: plan.groups.length,
                            })}
                            loading={createOrders.isPending}
                            onPress={createDrafts}
                        />
                    </>
                }
            >
                <Stack space="xs">
                    <Text testID="kitchen-supply-order-create-counts">
                        {t('kitchen:ops.supplyOrders.createConfirmCounts', {
                            count: plan.groups.length,
                            lines: plan.lineCount,
                        })}
                    </Text>
                    {/*
                     * The two kinds of "left behind", named apart (§4). A row with a quantity and
                     * nobody to buy it from is a job undone; a row somebody switched off is not.
                     */}
                    {plan.unassigned.length === 0 ? null : (
                        <Text
                            tone="warning"
                            variant="caption"
                            testID="kitchen-supply-order-create-unassigned"
                        >
                            {t('kitchen:ops.supplyOrders.unassignedCount', {
                                count: plan.unassigned.length,
                            })}
                        </Text>
                    )}
                    {plan.excluded.length === 0 ? null : (
                        <Text
                            tone="secondary"
                            variant="caption"
                            testID="kitchen-supply-order-create-excluded"
                        >
                            {t('kitchen:ops.supplyOrders.excludedCount', {
                                count: plan.excluded.length,
                            })}
                        </Text>
                    )}
                    {createFailed ? (
                        <Text tone="danger" testID="kitchen-supply-order-create-failed">
                            {t('kitchen:ops.supplyOrders.createFailed')}
                        </Text>
                    ) : null}
                </Stack>
            </Dialog>

            <Dialog
                open={confirmingRefresh}
                onClose={() => {
                    setConfirmingRefresh(false);
                }}
                title={t('kitchen:ops.supplyOrders.refreshConfirmTitle')}
                description={t('kitchen:ops.supplyOrders.refreshConfirmBody')}
                testID="kitchen-supply-order-refresh-confirm"
                actions={
                    <>
                        <Button
                            testID="kitchen-supply-order-refresh-cancel"
                            variant="secondary"
                            label={t('kitchen:ops.supplyOrders.refreshCancel')}
                            onPress={() => {
                                setConfirmingRefresh(false);
                            }}
                        />
                        <Button
                            testID="kitchen-supply-order-refresh-confirm-action"
                            label={t('kitchen:ops.supplyOrders.refreshConfirm')}
                            onPress={refresh}
                        />
                    </>
                }
            />
        </Stack>
    );
}
