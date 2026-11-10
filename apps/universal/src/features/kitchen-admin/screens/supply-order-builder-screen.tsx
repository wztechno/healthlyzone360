import type {
    OrderProposalItem,
    StockItem,
    Supplier,
    SupplierOption,
} from '@healthy360/api-client/contracts';
import type { StockItemId, SupplierId } from '@healthy360/domain-types';
import {
    Callout,
    Cascade,
    DataList,
    Dialog,
    EmptyState,
    ErrorState,
    FormSection,
    Icon,
    InfoTip,
    QuantityInput,
    Select,
    Skeleton,
    Stack,
    TableSkeleton,
    Text,
    useToast,
} from '@healthy360/design-system';
import type { DataListColumn, SelectOption } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { Gate } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import {
    useCreatePurchaseOrdersMutation,
    useOrderProposalQuery,
    useStockItemsQuery,
    useSuppliersQuery,
    useUpsertSupplierLinkMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { INVENTORY_ORDER_SUPPLIES_PERMISSION } from '../entity-registry.ts';
import { displayName, unitCodeLabel } from '../format.ts';
import { useCataloguePort } from '../catalogue/catalogue-nav.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { useUnsavedGuardFor } from '../use-unsaved-guard.ts';
import { BackPill } from '../../../ui/back-pill.tsx';
import { pathnameOf } from '../../../navigation/return-to.ts';
import { DeskButton, DeskCheckbox, DeskChip } from '../desk-kit/index.ts';
import { supplyOrderGroupTestId, supplyOrderRowTestId } from '../ops-format.ts';
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
 * Laid out as Post receipt is: the tables down the page, and beside them a sticky summary of what
 * is about to be created; the create sits in the opening only. The Operations
 * design's `edSupply` still sets the rows — the read-at notice with Refresh, *Needs ordering* with a
 * picker under it for anything else, and the shelves nobody can supply when there are any.
 *
 * ```
 * Prepare a supply order  ⚠ Unsaved                              [ Cancel ] [ Create 1 draft order ]
 * ⓘ Read at 14:32                                   Refresh  ┌ READY TO ORDER ──────────┐
 * ┌ NEEDS ORDERING  6 items · 2 out of stock ─────────────┐  │ Out of stock           2 │
 * │ Item          Reorder at / Par  Order qty  From   Ordering │ Running low            4 │
 * │ Tahini [OUT]       5 / 20      [ 20 ] kg [Beqaa ▾] Not ordering│ Lines to order     5 │
 * │ 0 kg on hand                                           │  │ Won't be ordered       1 │
 * │ [ Add something else… ]                                │  │ Draft orders           1 │
 * └────────────────────────────────────────────────────────┘  │ ──────────────────────── │
 * ┌ NOT LINKED TO A SUPPLIER YET ─ only when a row has nobody ┐ │ One draft per supplier   │
 * └────────────────────────────────────────────────────────┘  │ Beqaa Fresh     3 items  │
 *                                                             │ ⚠ 1 item won't be ordered│
 *                                                             └──────────────────────────┘
 * ```
 *
 * Items are named, never coded: the catalogue code (`aioli-sauce`) is a slug of the name beside it,
 * so the line under the name carries what is on the shelf instead, and the picker offers names.
 *
 * One page rather than steps, and the order of it is the order of the job: **what is short** (with
 * **what else you want**), **what nobody can supply**, and **what you are about to ask for**. The
 * three regions are read against each other — a quantity typed above moves a count below — and a
 * step between them hid the consequence of every keystroke.
 *
 * The rows are `DataList`s at the Catalogue's small density with `sm` controls: the design's 28px
 * row of one input, one picker and one toggle, rather than a table of full-height labelled fields.
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
 * ## The commit, and why the thing confirmed is the thing sent
 *
 * In the opening: a person reads *Ready to order* beside the rows, then presses the create at the
 * top of the page. The payload is `toBatchPayload(plan)` — the same pure function that built the
 * supplier rows above it — so the grouping somebody looked at and the request that leaves the device
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

/**
 * The summary's fixed track, and the least the tables beside it are allowed before it drops under
 * them — Post receipt's arithmetic, with the floor raised to what the rows' tracks add up to plus
 * the card's padding, so *Reorder at / Par* is never the column that pays for the aside.
 */
const ASIDE_WIDTH = 300;
const FORM_MIN_WIDTH = 740;
const COLUMN_GAP = 16;

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
    // `items` is the Requirements screen's shortfall, handed over as stock item ids.
    const params = useLocalSearchParams<{ items?: string; qty?: string; returnTo?: string }>();
    // Cancel steps back to wherever the builder was opened from — the book, a batch's shortfall or
    // Requirements.
    const back = useReturnTo(params.returnTo, '/kitchen/supply-orders');
    const toast = useToast();
    const access = useAccessState();

    const branchId = access.branch?.id ?? null;
    useKitchenTrailLeaf(t('kitchen:ops.supplyOrders.builderTitle'));

    // Seeded once from `items`; what the person adds afterwards is theirs.
    const [requestedIds, setRequestedIds] = useState<readonly StockItemId[]>(() =>
        (params.items ?? '')
            .split(',')
            .map((segment) => segment.trim())
            .filter((segment) => segment !== '')
            .map((segment) => segment as unknown as StockItemId),
    );
    /** Only the rows the person has touched. Untouched rows are answered by the server's defaults. */
    const [edits, setEdits] = useState<SupplyOrderChoices>({});
    const [touched, setTouched] = useState(false);
    // Leaving with rows changed asks first — Cancel, the trail, the sidebar, the browser's Back.
    const guard = useUnsavedGuardFor(touched, { message: t('kitchen:unsaved.browserPrompt') });
    const [remember, setRemember] = useState<Readonly<Record<string, boolean>>>({});
    const [confirmingRefresh, setConfirmingRefresh] = useState(false);
    const [confirmingCreate, setConfirmingCreate] = useState(false);
    /** Dialog-level, not toast-level: the batch failed, so the dialog stays open to be retried. */
    const [createFailed, setCreateFailed] = useState(false);
    /*
     * Read from the node rather than `onLayout`, which on the web delivered one early width and
     * nothing after — see the sale screen. The port re-reads on resize and when the page panel settles.
     */
    const port = useCataloguePort();
    const bodyWidth = port.width;

    const proposal = useOrderProposalQuery(branchId, requestedIds);
    // The whole live book, for the unlinked rows' picker: a shelf with no links may still be
    // assigned any active supplier, and this is the only place that set comes from.
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
    /*
     * Quantities the page that opened the builder worked out — Requirements' suggested buy, as
     * `qty=id:amount,…` — fill the rows nobody has touched yet, ticked to order. The server's own
     * suggestion only knows the reorder levels; Requirements knows the days ahead.
     */
    const [seeds] = useState<Readonly<Record<string, string>>>(() =>
        Object.fromEntries(
            (params.qty ?? '')
                .split(',')
                .map((pair) => pair.split(':'))
                .filter(
                    (pair): pair is [string, string] =>
                        pair.length === 2 && pair[0] !== '' && Number(pair[1]) > 0,
                ),
        ),
    );
    const effective = useMemo(() => {
        const base = initialChoices(rows, edits);
        const seeded: Record<string, SupplyOrderRowChoice> = { ...base };
        for (const [key, quantity] of Object.entries(seeds)) {
            const choice = base[key];
            if (choice === undefined || edits[key] !== undefined) continue;
            seeded[key] = { ...choice, quantity, ordering: true };
        }
        return seeded;
    }, [rows, edits, seeds]);

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
    const outOfStock = rows.filter((row: OrderProposalItem) => row.isOutOfStock).length;

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
            [key]: { ...(previous[key] ?? effective[key] ?? initialChoice(row)), ...patch },
        }));
    }

    /**
     * Tick a row on or off. Ticking on a row with an empty box fills it with the server's suggestion
     * where there is one, so "order all" is one press rather than one press and forty numbers.
     */
    function choose(row: OrderProposalItem, ordering: boolean): void {
        const current = effective[String(row.stockItemId)];
        const empty = (current?.quantity ?? '') === '';
        update(row, {
            ordering,
            ...(ordering && empty && row.suggestedQuantity !== null
                ? { quantity: row.suggestedQuantity }
                : {}),
        });
    }

    /** The header's tick: every row of a table on, or every row off. */
    function chooseAll(list: readonly OrderProposalItem[], ordering: boolean): void {
        setTouched(true);
        setEdits((previous) => {
            const next = { ...previous };
            for (const row of list) {
                const key = String(row.stockItemId);
                const current = previous[key] ?? effective[key] ?? initialChoice(row);
                const empty = current.quantity === '';
                next[key] = {
                    ...current,
                    ordering,
                    ...(ordering && empty && row.suggestedQuantity !== null
                        ? { quantity: row.suggestedQuantity }
                        : {}),
                };
            }
            return next;
        });
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
     * The commit. `toBatchPayload(plan)` is the object the supplier rows above were built from, so
     * what a person confirmed and what leaves the device cannot drift.
     *
     * On success the builder is done and steps aside: the landing page is where the new orders live,
     * and leaving somebody on a builder whose rows have just been ordered would invite a second
     * batch. `replace` rather than `push`, so Back does not return to a stale form.
     *
     * ## Why the print link travels in the URL rather than in the toast (SUP7, §7)
     *
     * §7 wants **Print them** offered the moment a batch exists — four drafts raised together are
     * four sheets somebody wants to walk to the printer with. The design system's `ToastOptions`
     * carries a message, a tone and a duration and no action slot, and growing one for a single
     * caller would put a control inside a thing that disappears on a timer: a person who looks away
     * loses the affordance and has no way back to it.
     *
     * So the identifiers ride to the landing page as `?created=`, which renders a standing success
     * callout carrying the link. It survives a glance away, it survives a refresh, and it is
     * addressable — the same query string is what the print route itself takes.
     *
     * On failure the dialog stays open with a danger line inside it. The batch is atomic — nothing
     * was saved — so the honest offer is "try again" rather than an explanation of partial state.
     */
    function createDrafts(): void {
        createOrders.mutate(toBatchPayload(plan), {
            onSuccess: (created) => {
                setConfirmingCreate(false);
                setCreateFailed(false);
                // Returned in request order (§6), and passed on in that order: the sheets come out
                // of the printer grouped the way the person grouped them.
                const ids = created.map((order) => String(order.id)).join(',');
                router.replace(
                    `/kitchen/supply-orders?created=${encodeURIComponent(ids)}` as never,
                );
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

    /**
     * Every column but the supplier cell, which the two regions render differently.
     *
     * Sized to sit beside the summary, as Post receipt's lines do: the item carries what is on the
     * shelf under its name — the line its catalogue code used to take — so the row gives up a whole
     * track rather than dropping *Reorder at / Par* on a laptop. The code went because a slug like
     * `aioli-sauce` beside "Aioli Sauce" says the name twice, the second time worse.
     */
    function baseColumns(): readonly DataListColumn<OrderProposalItem>[] {
        return [
            {
                key: 'item',
                label: t('kitchen:ops.supplyOrders.columnItem'),
                width: 240,
                priority: 100,
                render: (row) => {
                    const testID = supplyOrderRowTestId(String(row.stockItemId));
                    return (
                        <View className="w-full min-w-0 flex-1 flex-col overflow-hidden py-1">
                            <View className="min-w-0 flex-row items-center gap-1.5">
                                <Text variant="strong" numberOfLines={1} testID={`${testID}-name`}>
                                    {row.itemNameEn}
                                </Text>
                                {row.isOutOfStock ? (
                                    <DeskChip
                                        size="sm"
                                        testID={`${testID}-out`}
                                        tone="danger"
                                        label={t('kitchen:ops.supplyOrders.outBadge')}
                                    />
                                ) : row.isLow ? (
                                    <DeskChip
                                        size="sm"
                                        testID={`${testID}-low`}
                                        tone="warning"
                                        label={t('kitchen:ops.supplyOrders.lowBadge')}
                                    />
                                ) : null}
                            </View>
                            <Text
                                variant="caption"
                                tone="secondary"
                                numberOfLines={1}
                                className="tabular-nums"
                                testID={`${testID}-on-hand`}
                            >
                                {t('kitchen:ops.supplyOrders.onHand', {
                                    quantity: `${formatter.formatNumber(Number(row.quantityOnHand))} ${unitCodeLabel(row.unitCode, t)}`,
                                })}
                            </Text>
                            {/* Already on its way: what stops the same order being drafted twice. */}
                            {row.openOrders.length === 0 ? null : (
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    numberOfLines={1}
                                    className="tabular-nums"
                                    testID={`${testID}-on-order`}
                                >
                                    {/* The first order by number and how many more: a row of
                                        five PO numbers ran under the next three columns. */}
                                    {t(
                                        row.openOrders.length > 1
                                            ? 'kitchen:ops.supplyOrders.onOrderMore'
                                            : 'kitchen:ops.supplyOrders.onOrderShort',
                                        {
                                            quantity: `${formatter.formatNumber(Number(row.onOrderQuantity))} ${unitCodeLabel(row.unitCode, t)}`,
                                            first: row.openOrders[0]?.number ?? '',
                                            more: row.openOrders.length - 1,
                                        },
                                    )}
                                </Text>
                            )}
                        </View>
                    );
                },
            },
            {
                key: 'levels',
                // One column for both numbers: they are read together — "reorder at 5, fill to 20" —
                // and two columns of mostly em dashes would be two columns of nothing.
                label: t('kitchen:ops.supplyOrders.columnLevels'),
                // Wide enough for its header whole: a truncated "Reorder at / Rest…" named neither.
                width: 152,
                priority: 60,
                grow: false,
                render: (row) => (
                    <Text
                        variant="mono"
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
                label: t('kitchen:ops.supplyOrders.columnQuantity'),
                width: 136,
                priority: 95,
                grow: false,
                render: (row) => {
                    const key = String(row.stockItemId);
                    const testID = supplyOrderRowTestId(key);
                    const choice = effective[key];
                    const value = choice?.quantity ?? '';
                    const reading = readQuantity(value);
                    const showError =
                        reading.issue !== null && ERROR_ISSUES.has(reading.issue) && value !== '';

                    return (
                        <View className="min-w-0 flex-1">
                            <QuantityInput
                                testID={`${testID}-quantity`}
                                /*
                                 * Labelled with the item's own name, not a shared "Order
                                 * quantity". Forty inputs sharing one accessible name is a form
                                 * a screen-reader user cannot navigate, and the duplication is
                                 * invisible by eye.
                                 */
                                label={t('kitchen:ops.supplyOrders.quantityLabel', {
                                    item: row.itemNameEn,
                                })}
                                labelHidden
                                size="sm"
                                unit={unitCodeLabel(row.unitCode, t)}
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
                        </View>
                    );
                },
            },
        ];
    }

    /**
     * The tick at the start of a row — ordered or not — and, in the header, the tick for the whole
     * table. Unticking keeps the typed quantity: switching a row off and back on must not cost
     * somebody the number they worked out.
     */
    function orderingColumn(
        list: readonly OrderProposalItem[],
        testID: string,
    ): DataListColumn<OrderProposalItem> {
        const ticked = list.filter((row) => effective[String(row.stockItemId)]?.ordering ?? true);
        return {
            key: 'ordering',
            label: t('kitchen:ops.supplyOrders.orderAll'),
            width: 48,
            priority: 99,
            grow: false,
            renderHeader: () => (
                <DeskCheckbox
                    testID={`${testID}-order-all`}
                    label={t('kitchen:ops.supplyOrders.orderAll')}
                    checked={list.length > 0 && ticked.length === list.length}
                    mixed={ticked.length > 0 && ticked.length < list.length}
                    onChange={(next) => {
                        chooseAll(list, next);
                    }}
                />
            ),
            render: (row) => {
                const key = String(row.stockItemId);
                const ordering = effective[key]?.ordering ?? true;
                return (
                    <DeskCheckbox
                        testID={`${supplyOrderRowTestId(key)}-toggle`}
                        label={t('kitchen:ops.supplyOrders.orderItem', { item: row.itemNameEn })}
                        checked={ordering}
                        onChange={(next) => {
                            choose(row, next);
                        }}
                    />
                );
            },
        };
    }

    const assignedColumns: readonly DataListColumn<OrderProposalItem>[] = [
        orderingColumn(assigned, 'kitchen-supply-order-rows'),
        ...baseColumns(),
        {
            key: 'supplier',
            label: t('kitchen:ops.supplyOrders.columnFrom'),
            width: 200,
            priority: 90,
            render: (row) => {
                const key = String(row.stockItemId);
                const testID = supplyOrderRowTestId(key);
                const chosen = effective[key]?.supplierId ?? null;
                const options: readonly SelectOption[] = row.supplierOptions.map(
                    (option: SupplierOption) => ({
                        value: String(option.id),
                        label: option.nameEn,
                        // "Preferred" is worth the room; the code is searched, not drawn.
                        ...(option.isPreferred
                            ? { description: t('kitchen:ops.supplyOrders.preferredBadge') }
                            : {}),
                        keywords: option.code,
                    }),
                );
                const current = row.supplierOptions.find(
                    (option: SupplierOption) => String(option.id) === chosen,
                );

                return (
                    <View className="min-w-0 flex-1 flex-row items-center gap-hair py-hair">
                        <View className="min-w-0 flex-1">
                            <Select
                                testID={`${testID}-supplier-select`}
                                label={t('kitchen:ops.supplyOrders.supplierLabel', {
                                    item: row.itemNameEn,
                                })}
                                labelHidden
                                options={options}
                                value={chosen === null ? null : String(chosen)}
                                placeholder={t('kitchen:ops.supplyOrders.supplierPlaceholder')}
                                onChange={(value) => {
                                    chooseSupplier(row, value as SupplierId);
                                }}
                            />
                        </View>
                        {/*
                         * The two states the picker cannot say by itself: this is the preferred
                         * supplier, or there are candidates and nobody has chosen between them.
                         */}
                        {current === undefined ? (
                            <DeskChip
                                size="sm"
                                testID={`${testID}-choose-supplier`}
                                tone="warning"
                                label={t('kitchen:ops.supplyOrders.chooseSupplier')}
                            />
                        ) : current.isPreferred ? (
                            <DeskChip
                                size="sm"
                                testID={`${testID}-preferred`}
                                tone="info"
                                label={t('kitchen:ops.supplyOrders.preferredBadge')}
                            />
                        ) : null}
                    </View>
                );
            },
        },
    ];

    const unlinkedColumns: readonly DataListColumn<OrderProposalItem>[] = [
        orderingColumn(unlinked, 'kitchen-supply-order-unlinked-rows'),
        ...baseColumns(),
        {
            key: 'supplier',
            label: t('kitchen:ops.supplyOrders.columnFrom'),
            width: 340,
            priority: 90,
            render: (row) => {
                const key = String(row.stockItemId);
                const testID = supplyOrderRowTestId(key);
                const chosen = effective[key]?.supplierId ?? null;
                const options: readonly SelectOption[] = supplierChoices(row, directory).map(
                    (supplier) => ({
                        value: String(supplier.id),
                        label: supplier.nameEn,
                        keywords: supplier.code,
                    }),
                );

                return (
                    // One line: the picker, why it is empty, and "link to this item" after them,
                    // so the field sits level with the quantity instead of riding up over a tick.
                    <View className="z-auto min-w-0 flex-1 flex-row items-center gap-1.5 py-1">
                        <View className="z-auto min-w-0 flex-1 flex-row items-center gap-hair">
                            <View className="z-auto min-w-0 flex-1">
                                <Select
                                    testID={`${testID}-supplier-select`}
                                    label={t('kitchen:ops.supplyOrders.supplierLabel', {
                                        item: row.itemNameEn,
                                    })}
                                    labelHidden
                                    options={options}
                                    searchable
                                    value={chosen === null ? null : String(chosen)}
                                    placeholder={t('kitchen:ops.supplyOrders.supplierPlaceholder')}
                                    onChange={(value) => {
                                        chooseSupplier(row, value as SupplierId);
                                    }}
                                />
                            </View>
                            {/*
                             * The two reasons get different words because they have different fixes: a
                             * shelf nobody was ever linked to needs a supplier; a shelf whose suppliers
                             * are all archived needs one restored, or a different one linked. A tip
                             * beside the picker rather than a line above it, so the row stays level.
                             */}
                            <InfoTip
                                testID={`${testID}-reason`}
                                label={t('kitchen:ops.supplyOrders.columnFrom')}
                                text={
                                    row.unassignedReason === 'suppliersArchived'
                                        ? t('kitchen:ops.supplyOrders.reasonArchived')
                                        : t('kitchen:ops.supplyOrders.reasonNoSupplier')
                                }
                            />
                        </View>
                        <View testID={`${testID}-remember`} className="flex-row items-center">
                            <DeskCheckbox
                                testID={`${testID}-remember-control`}
                                label={t('kitchen:ops.supplyOrders.rememberLink')}
                                checked={remember[key] ?? true}
                                onChange={(checked) => {
                                    setRemember((previous) => ({ ...previous, [key]: checked }));
                                }}
                            />
                            <Text variant="label" numberOfLines={1} aria-hidden>
                                {t('kitchen:ops.supplyOrders.rememberLink')}
                            </Text>
                        </View>
                    </View>
                );
            },
        },
    ];

    /**
     * Every shelf, for **Add something else** — server ranking, never re-sorted. Named without the
     * catalogue code, as the rows above are; the type-ahead matches on the name.
     */
    const addOptions: readonly SelectOption[] = (stockItems.data ?? [])
        .filter(
            (item: StockItem) =>
                !rows.some((row: OrderProposalItem) => String(row.stockItemId) === String(item.id)),
        )
        .map((item: StockItem) => ({
            value: String(item.id),
            label: item.nameEn,
            description: unitCodeLabel(item.unitCode, t),
        }));

    const loaded = branchId !== null && !proposal.isPending && failure === null;
    const sideBySide = bodyWidth >= ASIDE_WIDTH + FORM_MIN_WIDTH + COLUMN_GAP;
    const lowOnly = rows.filter((row: OrderProposalItem) => row.isLow && !row.isOutOfStock).length;

    const openCreate = () => {
        setCreateFailed(false);
        setConfirmingCreate(true);
    };

    return (
        <Cascade space="md" testID="kitchen-supply-order-builder-screen">
            {/*
             * The desk's way back, as Requirements and the order pages draw it, where Cancel was; the
             * commit lives at the foot of the ticket, under what it creates.
             */}
            <View className="flex-row">
                <BackPill
                    testID="kitchen-supply-order-builder-cancel"
                    label={
                        back.returnTo !== null &&
                        pathnameOf(back.returnTo) === '/kitchen/order-desk/requirements'
                            ? t('kitchen:ops.supplyOrders.backToRequirements')
                            : t('kitchen:ops.supplyOrders.backToOrders')
                    }
                    onPress={() => {
                        guard.intercept(back.leave);
                    }}
                />
            </View>
            <RecordFormOpening
                testID="kitchen-supply-order-builder-screen"
                title={t('kitchen:ops.supplyOrders.builderTitle')}
                dirty={touched}
            />

            {branchId === null ? (
                <EmptyState
                    testID="kitchen-supply-order-builder-branch-required"
                    title={t('kitchen:ops.supplyOrders.branchRequiredTitle')}
                    body={t('kitchen:ops.supplyOrders.branchRequiredBody')}
                />
            ) : (
                <View
                    ref={Platform.OS === 'web' ? port.ref : undefined}
                    onLayout={Platform.OS === 'web' ? undefined : port.onLayout}
                    className={
                        sideBySide && loaded
                            ? 'z-auto flex-row items-start gap-base'
                            : 'z-auto flex-col gap-base'
                    }
                >
                    {/* The form is the row's filler beside the fixed summary. */}
                    <View className="z-auto min-w-0 flex-1 flex-col gap-base">
                        <Callout
                            testID="kitchen-supply-order-read-at"
                            tone="info"
                            role="note"
                            title={
                                readAt === null
                                    ? t('kitchen:ops.supplyOrders.readAtPending')
                                    : t('kitchen:ops.supplyOrders.readAt', {
                                          time: formatter.formatDate(readAt, {
                                              hour: '2-digit',
                                              minute: '2-digit',
                                          }),
                                      })
                            }
                            actions={
                                <DeskButton
                                    testID="kitchen-supply-order-refresh"
                                    variant="quiet"
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
                            }
                        />

                        {proposal.isPending ? (
                            <TableSkeleton
                                testID="kitchen-supply-order-builder-loading"
                                partTestID="kitchen-supply-order"
                                rows={4}
                            />
                        ) : failure !== null ? (
                            <ErrorState
                                testID="kitchen-supply-order-builder-error"
                                failure={failure}
                                onRetry={refresh}
                                retrying={proposal.isFetching}
                            />
                        ) : (
                            <>
                                <FormSection
                                    first
                                    variant="panel"
                                    testID="kitchen-supply-order-needs"
                                    title={t('kitchen:ops.supplyOrders.needsTitle')}
                                    aside={
                                        assigned.length === 0 ? undefined : (
                                            <Text
                                                variant="caption"
                                                tone="secondary"
                                                testID="kitchen-supply-order-needs-summary"
                                            >
                                                {outOfStock === 0
                                                    ? t('kitchen:ops.supplyOrders.needsCount', {
                                                          count: assigned.length,
                                                      })
                                                    : `${t('kitchen:ops.supplyOrders.needsCount', {
                                                          count: assigned.length,
                                                      })} · ${t(
                                                          'kitchen:ops.supplyOrders.outCount',
                                                          {
                                                              count: outOfStock,
                                                          },
                                                      )}`}
                                            </Text>
                                        )
                                    }
                                >
                                    <Stack space="sm">
                                        {assigned.length === 0 ? (
                                            <EmptyState
                                                testID="kitchen-supply-order-builder-empty"
                                                icon="success"
                                                title={t(
                                                    'kitchen:ops.supplyOrders.nothingNeededTitle',
                                                )}
                                                body={t(
                                                    'kitchen:ops.supplyOrders.builderEmptyBody',
                                                )}
                                            />
                                        ) : (
                                            <DataList<OrderProposalItem>
                                                testID="kitchen-supply-order-rows"
                                                label={t('kitchen:ops.supplyOrders.builderCaption')}
                                                columns={assignedColumns}
                                                rows={assigned}
                                                rowKey={(row) => String(row.stockItemId)}
                                                density="sm"
                                            />
                                        )}

                                        {/*
                                         * Anything else to order, under the rows it joins. Re-query
                                         * rather than append a row here: the server owns what a
                                         * proposal row looks like, suppliers resolved and all, so a
                                         * shelf somebody typed in comes back the same shape as one
                                         * that ran out.
                                         */}
                                        <View
                                            testID="kitchen-supply-order-add"
                                            className="z-tooltip w-full max-w-field"
                                        >
                                            <Select
                                                testID="kitchen-supply-order-add-select"
                                                label={t('kitchen:ops.supplyOrders.addTitle')}
                                                labelHidden
                                                size="sm"
                                                options={addOptions}
                                                searchable
                                                value={null}
                                                placeholder={t(
                                                    'kitchen:ops.supplyOrders.addPlaceholder',
                                                )}
                                                onChange={(value) => {
                                                    setRequestedIds((previous) => [
                                                        ...previous,
                                                        value as unknown as StockItemId,
                                                    ]);
                                                }}
                                            />
                                        </View>
                                    </Stack>
                                </FormSection>

                                {unlinked.length === 0 ? null : (
                                    <FormSection
                                        first
                                        variant="panel"
                                        testID="kitchen-supply-order-unlinked"
                                        title={t('kitchen:ops.supplyOrders.unlinkedTitle')}
                                        actions={
                                            <DeskButton
                                                testID="kitchen-supply-order-add-supplier"
                                                variant="quiet"
                                                label={t('kitchen:ops.supplyOrders.addSupplier')}
                                                iconStart={
                                                    <Icon
                                                        name="plus"
                                                        size="sm"
                                                        className="text-content-on-brand-subtle"
                                                    />
                                                }
                                                onPress={() => {
                                                    guard.intercept(() => {
                                                        router.push(
                                                            '/kitchen/suppliers/new' as never,
                                                        );
                                                    });
                                                }}
                                            />
                                        }
                                    >
                                        <DataList<OrderProposalItem>
                                            testID="kitchen-supply-order-unlinked-rows"
                                            label={t('kitchen:ops.supplyOrders.unlinkedCaption')}
                                            columns={unlinkedColumns}
                                            rows={unlinked}
                                            rowKey={(row) => String(row.stockItemId)}
                                            density="sm"
                                        />
                                    </FormSection>
                                )}
                            </>
                        )}
                    </View>

                    {loaded ? (
                        <SupplyTicket
                            testID="kitchen-supply-order-preview"
                            width={sideBySide ? ASIDE_WIDTH : null}
                            figures={[
                                {
                                    key: 'out',
                                    label: t('kitchen:ops.supplyOrders.metrics.outOfStock'),
                                    value: formatter.formatNumber(outOfStock),
                                },
                                {
                                    key: 'low',
                                    label: t('kitchen:ops.supplyOrders.metrics.low'),
                                    value: formatter.formatNumber(lowOnly),
                                },
                                {
                                    key: 'lines',
                                    label: t('kitchen:ops.supplyOrders.summaryLines'),
                                    value: formatter.formatNumber(plan.lineCount),
                                },
                                {
                                    key: 'left-behind',
                                    label: t('kitchen:ops.supplyOrders.summaryLeftBehind'),
                                    value: formatter.formatNumber(leftBehind),
                                },
                            ]}
                            drafts={formatter.formatNumber(plan.groups.length)}
                            groups={plan.groups.map((group) => ({
                                key: String(group.supplier.id),
                                testID: supplyOrderGroupTestId(String(group.supplier.id)),
                                name: displayName(
                                    {
                                        en: group.supplier.nameEn,
                                        ar: group.supplier.nameAr ?? '',
                                    },
                                    locale,
                                ).value,
                                value: t('kitchen:ops.supplyOrders.groupCount', {
                                    count: group.lines.length,
                                }),
                            }))}
                            note={
                                plan.unassigned.length === 0 &&
                                plan.excluded.length === 0 ? null : (
                                    <View className="flex-col gap-2">
                                        {plan.unassigned.length === 0 ? null : (
                                            <Callout
                                                testID="kitchen-supply-order-unassigned-warning"
                                                tone="warning"
                                                title={t(
                                                    'kitchen:ops.supplyOrders.unassignedCount',
                                                    { count: plan.unassigned.length },
                                                )}
                                            />
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
                                    </View>
                                )
                            }
                            action={
                                <DeskButton
                                    testID="kitchen-supply-order-builder-create"
                                    size="lg"
                                    block
                                    label={t('kitchen:ops.supplyOrders.createDrafts', {
                                        count: plan.groups.length,
                                    })}
                                    loading={createOrders.isPending}
                                    disabled={plan.groups.length === 0 || createOrders.isPending}
                                    onPress={openCreate}
                                />
                            }
                        />
                    ) : null}
                </View>
            )}

            <Dialog
                look="card"
                open={confirmingCreate}
                onClose={() => {
                    setConfirmingCreate(false);
                }}
                title={t('kitchen:ops.supplyOrders.createConfirmTitle')}
                description={t('kitchen:ops.supplyOrders.createConfirmBody')}
                testID="kitchen-supply-order-create-confirm"
                actions={
                    <>
                        <DeskButton
                            testID="kitchen-supply-order-create-cancel"
                            variant="secondary"
                            label={t('kitchen:ops.supplyOrders.createCancel')}
                            onPress={() => {
                                setConfirmingCreate(false);
                            }}
                        />
                        <DeskButton
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
                            lines: t('kitchen:ops.supplyOrders.createConfirmLines', {
                                count: plan.lineCount,
                            }),
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
                look="card"
                open={confirmingRefresh}
                onClose={() => {
                    setConfirmingRefresh(false);
                }}
                title={t('kitchen:ops.supplyOrders.refreshConfirmTitle')}
                description={t('kitchen:ops.supplyOrders.refreshConfirmBody')}
                testID="kitchen-supply-order-refresh-confirm"
                actions={
                    <>
                        <DeskButton
                            testID="kitchen-supply-order-refresh-cancel"
                            variant="secondary"
                            label={t('kitchen:ops.supplyOrders.refreshCancel')}
                            onPress={() => {
                                setConfirmingRefresh(false);
                            }}
                        />
                        <DeskButton
                            testID="kitchen-supply-order-refresh-confirm-action"
                            label={t('kitchen:ops.supplyOrders.refreshConfirm')}
                            onPress={refresh}
                        />
                    </>
                }
            />

            <EditorGuardDialogs guard={guard} testID="kitchen-supply-order-builder-screen" />
        </Cascade>
    );
}

/* ── the ticket ──────────────────────────────────────────────────────────────────────────────── */

/**
 * What will be created, as the Orders calendar's day panel draws a day (2026-11-11): an eyebrow and
 * the count of drafts, the four figures in sunken tiles, one row per supplier's draft, the notes on
 * what is left behind, and the commit pinned at its foot.
 *
 * ```
 * READY TO ORDER
 * 2 draft orders
 * [Out of stock 4] [Running low 52]
 * [Lines to order 3] [Won't be ordered 57]
 * One draft per supplier
 *   Phoenicia Wholesale Foods      2 items
 *   Beirut Packaging Co.           1 item
 * ((        Create 2 draft orders        ))
 * ```
 *
 * The ids are `RecordSummaryAside`'s, which it replaces: the root, `-${figure}`, `-total`, the
 * groups list and its empty line.
 */
function SupplyTicket({
    testID,
    width,
    figures,
    drafts,
    groups,
    note,
    action,
}: {
    readonly testID: string;
    readonly width: number | null;
    readonly figures: readonly {
        readonly key: string;
        readonly label: string;
        readonly value: string;
    }[];
    readonly drafts: string;
    readonly groups: readonly {
        readonly key: string;
        readonly testID: string;
        readonly name: string;
        readonly value: string;
    }[];
    readonly note: ReactNode;
    readonly action: ReactNode;
}) {
    const { t } = useTranslation();
    return (
        <View
            testID={testID}
            role="region"
            aria-label={t('kitchen:ops.supplyOrders.readyTitle')}
            style={width === null ? undefined : { width }}
            className="flex-col gap-2.5 rounded-[22px] border border-stroke-subtle bg-surface-raised p-4 web:sticky web:top-0"
        >
            <View className="flex-col">
                <Text
                    variant="micro"
                    tone="secondary"
                    className="!text-xs font-bold uppercase tracking-widest"
                >
                    {t('kitchen:ops.supplyOrders.readyTitle')}
                </Text>
                <View className="mt-0.5 flex-row items-baseline gap-2">
                    <Text
                        variant="section"
                        className="font-display !text-[22px] !font-bold !leading-7 tabular-nums"
                        testID={`${testID}-total`}
                    >
                        {drafts}
                    </Text>
                    <Text variant="strong" tone="secondary">
                        {t('kitchen:ops.supplyOrders.summaryDrafts')}
                    </Text>
                </View>
            </View>

            <View className="flex-row flex-wrap gap-1.5">
                {figures.map((figure) => (
                    <View
                        key={figure.key}
                        className="min-w-[45%] flex-1 flex-col rounded-[14px] bg-surface-sunken px-3 py-2.5"
                    >
                        <Text
                            variant="label"
                            tone="secondary"
                            numberOfLines={1}
                            className="!font-semibold"
                        >
                            {figure.label}
                        </Text>
                        {figure.value === '' ? (
                            <Skeleton heightClassName="h-6" widthClassName="w-10" />
                        ) : (
                            <Text
                                variant="title"
                                className="mt-0.5 font-display !text-xl !font-bold tabular-nums"
                                testID={`${testID}-${figure.key}`}
                            >
                                {figure.value}
                            </Text>
                        )}
                    </View>
                ))}
            </View>

            <View className="flex-col gap-0.5">
                <View className="min-h-8 flex-row items-center px-1">
                    <Text variant="strong" className="!text-sm !font-bold">
                        {t('kitchen:ops.supplyOrders.summaryBySupplier')}
                    </Text>
                </View>
                {groups.length === 0 ? (
                    <Text
                        variant="caption"
                        tone="secondary"
                        className="px-1"
                        testID={`${testID}-empty`}
                    >
                        {t('kitchen:ops.supplyOrders.readyEmpty')}
                    </Text>
                ) : (
                    <View testID="kitchen-supply-order-groups" className="flex-col">
                        {groups.map((group) => (
                            <View
                                key={group.key}
                                testID={group.testID}
                                className="min-h-10 flex-row items-center gap-2.5 rounded-xl px-2"
                            >
                                <Text
                                    variant="strong"
                                    numberOfLines={1}
                                    className="min-w-0 flex-1 !text-sm"
                                >
                                    {group.name}
                                </Text>
                                <DeskChip tone="success" label={group.value} />
                            </View>
                        ))}
                    </View>
                )}
            </View>

            {note}
            {action}
        </View>
    );
}
