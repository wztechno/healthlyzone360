import type {
    KitchenOrder,
    KitchenOrderLine,
    KitchenOrderPaymentMethod,
    OrderDeskDeliveryJob,
    OrderDeskFulfilmentType,
    OrderDeskQueueFilters,
    OrderDeskQueueRow,
    OrderDeskQueueStatus,
    OrderDeskWindow,
} from '@healthy360/api-client/contracts';
import {
    KITCHEN_ORDER_PAYMENT_METHODS,
    ORDER_DESK_FULFILMENT_TYPES,
    ORDER_DESK_QUEUE_STATUSES,
    ORDER_DESK_WINDOWS,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Dialog,
    EmptyState,
    ErrorState,
    FilterChip,
    Icon,
    Inline,
    SearchInput,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { MenuItem } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useConfirmOrderMutation,
    useFulfilOrderMutation,
    useKitchenOrderQuery,
    useRecordOrderPaymentMutation,
} from '../../../data/kitchen-orders-hooks.ts';
import {
    useAssignDeliveryJobMutation,
    useOrderDeskDriversQuery,
    useOrderDeskQueueQuery,
} from '../../../data/order-desk-hooks.ts';
import { useOnlineStatus } from '../../../online/online-status.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { ORDER_MANAGE_PERMISSION, ORDER_VIEW_PERMISSION } from '../entity-registry.ts';
import { CatalogueList } from '../catalogue/catalogue-list.tsx';
import { CATALOGUE_ROW_ICONS } from '../catalogue/catalogue-list-item.tsx';
import { RecordViewPage } from '../catalogue/record-view-page.tsx';
import { CatalogueStatCards } from '../catalogue/index.ts';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import type { CatalogueColumn } from '../catalogue/catalogue-column-spec.ts';
import type { ControlledColumn } from '../catalogue/use-column-controls.tsx';
import {
    compareNumber,
    compareText,
    useColumnControls,
} from '../catalogue/use-column-controls.tsx';
import type { CatalogueStatCard } from '../catalogue/index.ts';
import { humaniseCode, minorAmountToInput, parseMinorAmount } from '../format.ts';
import {
    canAssignDeliveryJob,
    canConfirmKitchenOrder,
    canFulfilKitchenOrder,
    deliveryJobStatusKey,
    deliveryJobTrackingKey,
    filterDrivers,
    kitchenOrderFulfilmentTypeKey,
    kitchenOrderPaymentMethodKey,
    kitchenOrderStatusKey,
    kitchenOrderStatusTone,
    orderDeskDeliveryState,
    orderDeskDeliveryStateKey,
    orderDeskDueTone,
    orderDeskRowTestId,
} from '../ops-format.ts';
import { DeskAmount, DeskFact } from '../order-desk/desk-parts.tsx';
import { DueBadge, PaymentCell } from '../order-desk/queue-cells.tsx';

/**
 * `/kitchen/order-desk` — the open order book in the order somebody at a desk has to work it.
 *
 * ## Why this is a second screen over the same orders
 *
 * `/kitchen/orders` is the *book*: every order, newest first, paged, with the detail panel that
 * confirms, fulfils and cancels. This is the *queue*, and the difference is the sort. The endpoint
 * answers rows ordered by a `due_at` computed in SQL from the requested day, the delivery window's
 * opening hour and the branch's clock — a sort no client can reproduce and no cursor can page
 * through. So the queue is **bounded rather than paged** (see the truncation callout below) and it
 * carries **no sortable columns**: there is no server-sort plumbing anywhere in this application,
 * and a header that reordered two hundred rows locally would quietly answer a different question
 * from the one the screen exists to answer.
 *
 * ## The record page re-reads the order it was opened from — and keeps the row it was opened from
 *
 * Two reads, and each answers something the other cannot. The **detail** read
 * (`useKitchenOrderQuery`) is what the transitions send `If-Match` from: the version a queue row was
 * rendered from can be a poll or two old, and sending it would earn a `resource.conflict` the person
 * did nothing to deserve. This is `orders-screen.tsx`'s rule, and the write responses are seeded
 * straight back into that entry by the hook, which is what lets "Fulfil" fire immediately after
 * "Confirm" with a version the server will accept.
 *
 * The **row** is kept because the detail endpoint does not serve a delivery job or a payment
 * position at all — those live only on the queue's own row. So the record page holds the row it was
 * opened from and re-reads it out of the live queue on every poll, falling back to the last known
 * copy when the order leaves the queue (which is exactly what fulfilling it does). A page that
 * dropped its delivery block the instant the agent closed the order would look like a fault.
 *
 * ## Closing is offered on evidence, not gated on it
 *
 * "Fulfil" means *the customer has it*, and on a delivery the only evidence of that is the driver's
 * own stamp — which arrives on the job's tracking axis, minutes after it happened, and sometimes not
 * at all when a phone is in a pocket in a lift. So the desk is **not blocked** on
 * `tracking_status === 'delivered'`: an agent on the telephone to a customer who has the food in
 * their hands knows something the board does not. What the record page does instead is put the tracking
 * status *beside* the button, so the close is made informed rather than blind.
 *
 * A counter sale never reaches this record page needing anything: it arrives already `fulfilled` and
 * therefore is not in the open queue at all.
 *
 * ## The delivery column, and the assignment that finally has a picker
 *
 * The column reads {@link orderDeskDeliveryState} — five states, four of which this queue meets
 * often (see `ops-format.ts` for what each one means and why none collapses into another).
 *
 * The record page now offers **Assign**, and the reason it did not for a whole slice is worth keeping:
 * `POST /delivery/jobs/{job}/assign` takes a `driver_user_id` that must name an active member of
 * the organisation, and until `GET /catalogue/order-desk/drivers` landed nothing on this platform
 * listed one — so the only control that could have been drawn was a free-text box for a UUID, which
 * is a way to hand tonight's run to a typo. The picker is {@link AssignDriverDialog}; the validator
 * it sends is the **job's**, which rides on the queue row for exactly this purpose, and the two
 * readings of `409` are told apart there rather than here.
 *
 * ## The queue is organisation-wide, and that is a decision rather than an omission
 *
 * The endpoint takes a `branch_id` and this screen does not send one. Two things follow from that
 * parameter and only one of them is wanted here. It narrows the queue to orders *attributed* to a
 * branch — and an order delivered through an organisation-wide zone carries `branch_id: NULL`, as
 * the live book's real orders do, so sending the active branch would not scope the desk, it would
 * delete unattributed work from a screen whose whole job is that nothing goes unnoticed
 * (`features/kds/kds-board.ts` documents the same trap at length). It also names the clock `today`
 * is read on, and *that* is worth having — which is why the header states the day and the zone the
 * server actually used (`meta.today`, `meta.timezone`, echoed precisely because the client did not
 * choose them). Unnamed, the boundary is UTC. A branch picker is a later slice's, where somebody
 * chooses to narrow and can see that they have.
 *
 * ## Ageing is the kitchen display's scale, measured from a different instant
 *
 * `orderDeskDueTone` is `ticketAgeTone` — amber at fifteen minutes, red at thirty — against minutes
 * *past due*, clamped at zero so an order that is early is simply neutral. Colour never carries it
 * alone: the badge's label is the interval itself, spelled by the locale's own relative-time
 * formatter, so "in 3 hours" and "2 hours ago" read the same to somebody who cannot separate amber
 * from red. `ops-format.ts` holds the argument.
 *
 * ## Two filters that look alike and are not
 *
 * The status chips are a **subset** filter — neither selected means both, which a single-choice
 * control cannot say without inventing an "All" value the wire does not have. The fulfilment-type
 * `Select` is the opposite: the endpoint takes exactly one value or none, because the three types are
 * three different jobs done by three different people, and nobody at a desk asks for "deliveries and
 * counter sales but not pickups". The controls differ because the questions differ, and each one can
 * express exactly what its endpoint accepts.
 *
 * ## Money is recorded from the record page, and it is the only write here that changes nothing
 *
 * A counter sale settles itself. A delivery is paid at the door and a pickup on collection, both
 * after placement, by whoever was standing there — so the record page offers {@link RecordPaymentDialog}
 * while an order is unsettled, not cancelled, and the reader may manage orders. It sends the order's
 * `lockVersion` from the **detail** read like the lifecycle buttons do, and unlike them the server
 * does not bump it: the precondition is there so nobody records a payment against an order somebody
 * cancelled while the dialog was open, not because the row is being moved. The figures it prefills
 * come off the queue row, because the detail endpoint serves no payment position at all.
 *
 * ## The customer column must not look broken to somebody who may not read it
 *
 * `row.customer` is **absent** — not null — for a caller without
 * `order.view_customer_contact_organisation`, and `displayName` is null for an anonymised account
 * that the caller *may* read. Both render an em dash, deliberately: the screen has nothing to say in
 * either case, and a "you are not permitted" cell on every row of a queue somebody works all day
 * would be noise about the reader rather than information about the order. The distinction is kept
 * where it is useful — in the contract and the mapper — rather than shown here.
 *
 * The number under the name is **the order's, not the account's**, wherever the order snapshotted
 * one: a caller ordering to their mother's flat gives their mother's landline, and it is the number
 * on the docket the courier is holding. The server decides that and this screen never re-derives it,
 * which is the same rule the due badge follows — see the contract.
 */

/**
 * Poll cadence for the queue and its clock.
 *
 * Its own constant rather than an import of `KDS_POLL_MS`: that one lives in the kitchen display's
 * *screen* module, and importing it would pull the whole board — its queries, its mutations, its
 * tree — into this slice's dependency graph to read a number. Fifteen seconds for the same reason
 * the board picked it: short enough that an order reaches the desk before the customer wonders, long
 * enough that a tablet left on all day is not making six requests a minute.
 */
export const ORDER_DESK_POLL_MS = 15_000;

const WINDOW_LABEL_KEYS: Readonly<Record<OrderDeskWindow, string>> = {
    today: 'kitchen:desk.window.today',
    overdue: 'kitchen:desk.window.overdue',
    next_7: 'kitchen:desk.window.next7',
};

/**
 * What a cell with nothing to say renders as — the same character the cost report, the purchases
 * ledger and the exception queue use, kept as a named constant here because this screen has two
 * quite different reasons to reach for it and the name is what makes them read as one rule.
 */
const EM_DASH = '—';

/**
 * The value the type filter carries for "do not narrow".
 *
 * A sentinel rather than `null`, because `Select` is a single-choice control and "all kinds" is one
 * of its choices — the same shape `list-toolbar.tsx` uses for its category filter. It is deliberately
 * not a value the wire has: the filter is *absent* from the request when this is chosen, which is
 * what the server reads as "all three".
 */
const ANY_FULFILMENT_TYPE = '__any__';

/**
 * The toolbar's fixed sizes — stated as styles because neither has a token. The search never
 * narrows below an order number and a name, and takes whatever the row has left over; the kind
 * picker is wide enough for its longest label.
 */
const SEARCH_MIN_WIDTH = 240;
const KIND_WIDTH = 140;

/** Rows per page. The queue arrives whole, so the pages are cut from the loaded rows. */
const PAGE_SIZE = 18;

/**
 * Choose whose evening this is.
 *
 * ## Why a dialog rather than a step in the record page
 *
 * The record page is a *reading* surface — the order, its money, its run — and it stays open behind this.
 * Assigning is one decision with one confirmation, taken and finished, which is what a dialog is
 * for; folding a searchable list of a hundred people into a panel somebody is reading would push
 * the lifecycle buttons off the bottom of a laptop screen.
 *
 * ## The search is client-side, and that is a fact about the endpoint
 *
 * `listDrivers` is bounded at a hundred rows, has no second page and takes no search parameter, so
 * every row this picker could ever offer arrives in one read. `filterDrivers` narrows it without a
 * round trip per keystroke. A nameless member cannot match a non-empty search — there is no text to
 * match — which is why the "nothing found" state offers to clear the box rather than announcing
 * that nobody is available.
 *
 * ## The two conflicts, and how a screen tells them apart
 *
 * `409 resource.conflict` covers two quite different situations, and on this client the only thing
 * separating them is whether a version came back (`contracts/failure.ts` normalises the code down to
 * the optional `currentLockVersion` and drops the rest):
 *
 * - **with a version** — a lost race. Somebody else took the run in the seconds since this record page
 *   was drawn. The remedy is to re-read and look again, so a Refresh button is offered.
 * - **without one** — the run is over: delivered, failed or cancelled. There is **no retry offered
 *   at all**, because re-reading will not make a delivered job assignable, and a Refresh button
 *   there would be an invitation to press the same wall twice.
 *
 * That discriminator is the assign operation's own documented contract, and it is the reason this
 * dialog never simply prints `failure.message` for a conflict.
 *
 * ## The version it sends is the job's
 *
 * Never the order's. The two rows are versioned separately and assigning a driver deliberately does
 * not touch the order — crossing them would earn a `resource.conflict` on a race nobody entered.
 * The job's validator rides on the queue row for exactly this reason, so no second read is needed.
 */
function AssignDriverDialog({
    job,
    orderNumber,
    onClose,
    onAssigned,
    onRefresh,
    refreshing,
}: {
    readonly job: OrderDeskDeliveryJob;
    readonly orderNumber: string;
    readonly onClose: () => void;
    readonly onAssigned: (driverName: string) => void;
    readonly onRefresh: () => void;
    readonly refreshing: boolean;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [chosen, setChosen] = useState<string | null>(null);

    // Mounted only while the picker is open — see the note above — so the read starts here and a
    // directory of the organisation's members never sits behind a queue that polls every fifteen
    // seconds and may never assign anything.
    const drivers = useOrderDeskDriversQuery();
    const assign = useAssignDeliveryJobMutation();

    const rows = useMemo(() => drivers.data?.rows ?? [], [drivers.data]);
    const filtered = useMemo(() => filterDrivers(rows, query), [rows, query]);
    const listFailure = toFailure(drivers.error);
    const assignFailure = toFailure(assign.error);
    const conflict = assignFailure?.code === 'resource.conflict' ? assignFailure : null;
    // The discriminator, in one place. A number means a lost race; its absence means the run is
    // over — see the component note.
    const lostRace = conflict !== null && conflict.currentLockVersion !== undefined;

    // Looked up in the **whole** list rather than the filtered one: somebody who chooses a person
    // and then types in the search box has still chosen them, and reading the name out of the
    // narrowed list would announce an em dash for a driver who has one.
    const chosenDriver = rows.find((driver) => driver.userId === chosen) ?? null;

    function confirm() {
        if (chosen === null) return;
        assign.mutate(
            // The **job's** version, from the queue row. Never `order.lockVersion`.
            { jobId: job.id, driverUserId: chosen, lockVersion: job.lockVersion },
            {
                onSuccess: () => {
                    onAssigned(chosenDriver?.displayName ?? EM_DASH);
                },
            },
        );
    }

    return (
        <Dialog
            testID="kitchen-order-desk-assign"
            open
            onClose={onClose}
            title={t('kitchen:desk.assign.title')}
            description={t('kitchen:desk.assign.description', { number: orderNumber })}
            actions={
                <>
                    <Button
                        testID="kitchen-order-desk-assign-cancel"
                        variant="secondary"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="kitchen-order-desk-assign-confirm"
                        label={t('kitchen:desk.assign.confirm')}
                        loading={assign.isPending}
                        // Nothing chosen is not an error to report, it is a button that has
                        // nothing to do yet.
                        disabled={chosen === null || assign.isPending}
                        onPress={confirm}
                    />
                </>
            }
        >
            {assignFailure === null ? null : conflict !== null ? (
                <Callout
                    testID="kitchen-order-desk-assign-conflict"
                    tone="warning"
                    role="alert"
                    title={t(
                        lostRace
                            ? 'kitchen:desk.assign.raceTitle'
                            : 'kitchen:desk.assign.terminalTitle',
                    )}
                    body={t(
                        lostRace
                            ? 'kitchen:desk.assign.raceBody'
                            : 'kitchen:desk.assign.terminalBody',
                    )}
                    actions={
                        lostRace ? (
                            <Button
                                testID="kitchen-order-desk-assign-conflict-refresh"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:ops.orders.conflictRefresh')}
                                loading={refreshing}
                                onPress={() => {
                                    assign.reset();
                                    onRefresh();
                                }}
                            />
                        ) : undefined
                    }
                />
            ) : (
                <Text testID="kitchen-order-desk-assign-error" tone="danger" role="alert">
                    {assignFailure.message}
                </Text>
            )}

            <TextInputField
                testID="kitchen-order-desk-assign-search"
                id="kitchen-order-desk-assign-search"
                label={t('kitchen:desk.assign.searchLabel')}
                placeholder={t('kitchen:desk.assign.searchPlaceholder')}
                hint={t('kitchen:desk.assign.searchHint')}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="search"
                returnKeyType="search"
                trailing={<Icon name="search" />}
            />

            {drivers.isPending ? (
                <Skeleton testID="kitchen-order-desk-assign-loading" heightClassName="h-24" />
            ) : listFailure !== null ? (
                <ErrorState
                    testID="kitchen-order-desk-assign-list-error"
                    title={t('kitchen:desk.assign.listErrorTitle')}
                    failure={listFailure}
                    onRetry={() => {
                        void drivers.refetch();
                    }}
                    retrying={drivers.isFetching}
                />
            ) : filtered.length === 0 ? (
                <EmptyState
                    testID="kitchen-order-desk-assign-empty"
                    title={t(
                        rows.length === 0
                            ? 'kitchen:desk.assign.noneTitle'
                            : 'kitchen:desk.assign.noMatchTitle',
                    )}
                    body={t(
                        rows.length === 0
                            ? 'kitchen:desk.assign.noneBody'
                            : 'kitchen:desk.assign.noMatchBody',
                    )}
                />
            ) : (
                <View
                    testID="kitchen-order-desk-assign-list"
                    className="flex-col border-t border-stroke-subtle"
                >
                    {filtered.map((driver) => (
                        // The row is inert and the button is the control — a pressable row
                        // wrapping a button is nested-interactive, which axe reports as serious.
                        // The same shape the sale wizard's customer picker uses, for the same
                        // reason: choosing is not assigning. The confirmation is the footer
                        // button, because a list of a hundred one-tap assignments would be one
                        // mis-tap away from sending tonight's run to the wrong person.
                        <View
                            key={driver.userId}
                            testID={`kitchen-order-desk-assign-driver-${driver.userId}`}
                            className={
                                chosen === driver.userId
                                    ? 'min-h-row-md flex-row items-center justify-between gap-tight border-b border-stroke-subtle bg-surface-brand-subtle px-control-sm'
                                    : 'min-h-row-md flex-row items-center justify-between gap-tight border-b border-stroke-subtle px-control-sm'
                            }
                        >
                            <Text
                                variant="label"
                                // The dash is silent to a screen reader, so the row says in
                                // words what it has instead of a name.
                                {...(driver.displayName === null
                                    ? { accessibilityLabel: t('kitchen:desk.assign.unnamed') }
                                    : {})}
                            >
                                {driver.displayName ?? EM_DASH}
                            </Text>
                            {chosen === driver.userId ? (
                                <Badge
                                    testID={`kitchen-order-desk-assign-driver-${driver.userId}-chosen`}
                                    tone="success"
                                    label={t('kitchen:desk.assign.chosen')}
                                />
                            ) : (
                                <Button
                                    testID={`kitchen-order-desk-assign-driver-${driver.userId}-choose`}
                                    size="sm"
                                    variant="quiet"
                                    label={t('kitchen:desk.assign.choose')}
                                    onPress={() => {
                                        setChosen(driver.userId);
                                    }}
                                />
                            )}
                        </View>
                    ))}
                    {rows.length >= (drivers.data?.limit ?? Number.POSITIVE_INFINITY) ? (
                        <Text
                            variant="caption"
                            tone="secondary"
                            testID="kitchen-order-desk-assign-capped"
                        >
                            {t('kitchen:desk.assign.capped', { limit: drivers.data?.limit ?? 0 })}
                        </Text>
                    ) : null}
                </View>
            )}
        </Dialog>
    );
}

/**
 * Write down money that has arrived.
 *
 * ## Why the desk needs this at all
 *
 * A counter sale settles itself — the wizard takes the money and the order comes back already
 * fulfilled. The other two do not: a delivery is paid at the door and a pickup on collection, both
 * *after* the order was placed, by whoever was standing there. Until this dialog existed the queue
 * could show that an order was unsettled and offer nothing to do about it, so the receipt was written
 * on paper and the payment column stayed wrong for the rest of the shift.
 *
 * ## The version it sends is the **order's**, from the detail read
 *
 * Same rule the lifecycle buttons follow, and for the same reason: the queue row was rendered from a
 * poll that may be fifteen seconds old. What differs is what the precondition is *for*. Confirm and
 * fulfil are guarded because they move the order; this one does not move it at all — the guard is
 * there so that nobody records a payment against an order somebody cancelled while this dialog was
 * open. The server does not bump the version either, so the caller may record a second part payment
 * straight afterwards without re-reading.
 *
 * ## The two conflicts, told apart the way the assign dialog tells its two apart
 *
 * `409 resource.conflict` covers a stale precondition and a cancelled order, and on this client the
 * only thing separating them is whether a version came back (`contracts/failure.ts` normalises the
 * code down to the optional `currentLockVersion`):
 *
 * - **with a version** — the order moved. Re-read and try again; a Refresh button is offered.
 * - **without one** — the order is cancelled. **No retry is offered**, because refreshing will not
 *   make a cancelled order payable, and money that genuinely changed hands on a cancelled order is a
 *   refund, which is a different object with different money attached.
 *
 * ## The method is not constrained to the order's, and the reference is where WISH lives
 *
 * A sale taken as cash and settled by a transfer while the customer stood there is an ordinary
 * evening, so the select offers all three and merely *defaults* to what the order was taken on.
 * Choosing `wish` raises the wizard's own manual-confirmation warning verbatim — the same two
 * sentences, from the same keys, because a second wording of "nothing checks this for us" would be a
 * second policy — and the reference field is where that confirmation actually rests.
 *
 * ## The amount is prefilled and editable
 *
 * Prefilled with the outstanding remainder, which is what an agent asks for nine times in ten.
 * Editable because part payments are ordinary and over-payments are legal: the money arrived, and a
 * ledger that refused to record what happened would send somebody looking for paper again. It is a
 * major-unit field parsed by `parseMinorAmount`, so `5.505` in dollars is refused as the typo it is
 * rather than silently rounded into a figure nobody typed.
 */
function RecordPaymentDialog({
    order,
    row,
    onClose,
    onRecorded,
    onRefresh,
    refreshing,
}: {
    readonly order: KitchenOrder;
    readonly row: OrderDeskQueueRow;
    readonly onClose: () => void;
    readonly onRecorded: (amount: string) => void;
    readonly onRefresh: () => void;
    readonly refreshing: boolean;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const record = useRecordOrderPaymentMutation();

    /**
     * What is still owed, never below zero. An over-paid order cannot reach this dialog — the action
     * is offered only while `receipted` is false — but the clamp is here anyway, because the figure
     * seeds a text field and a negative default would be a form that opens invalid.
     */
    const outstandingMinor = Math.max(0, row.totalMinor - row.payment.receivedMinor);

    const [method, setMethod] = useState<KitchenOrderPaymentMethod>(row.payment.method);
    const [amount, setAmount] = useState(() =>
        minorAmountToInput(outstandingMinor, row.currencyCode),
    );
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');

    const amountMinor = parseMinorAmount(amount, row.currencyCode);
    // At least one minor unit: the server refuses zero, and a receipt asserting that no money
    // changed hands is a keystroke rather than evidence.
    const amountValid = amountMinor !== null && amountMinor >= 1;

    const failure = toFailure(record.error);
    const conflict = failure?.code === 'resource.conflict' ? failure : null;
    // The discriminator, in one place — see the component note.
    const stale = conflict !== null && conflict.currentLockVersion !== undefined;

    function submit() {
        if (amountMinor === null || !amountValid) return;
        record.mutate(
            {
                id: order.id,
                // The **order's** version, from the detail read. Never the queue row's.
                lockVersion: order.lockVersion,
                method,
                amountMinor,
                // Trimmed to absence rather than sent empty: the server distinguishes "no
                // reference" from a reference somebody cleared, and an empty string is neither.
                ...(reference.trim() === '' ? {} : { reference: reference.trim() }),
                ...(notes.trim() === '' ? {} : { notes: notes.trim() }),
            },
            {
                onSuccess: () => {
                    onRecorded(
                        formatMoney(formatter, {
                            amount: amountMinor,
                            currency: row.currencyCode,
                        }),
                    );
                },
            },
        );
    }

    return (
        <Dialog
            testID="kitchen-order-desk-payment"
            open
            onClose={onClose}
            title={t('kitchen:desk.recordPayment.title')}
            description={t('kitchen:desk.recordPayment.description', {
                number: row.orderNumber,
            })}
            actions={
                <>
                    <Button
                        testID="kitchen-order-desk-payment-cancel"
                        variant="secondary"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="kitchen-order-desk-payment-confirm"
                        label={t('kitchen:desk.recordPayment.confirm')}
                        loading={record.isPending}
                        disabled={!amountValid || record.isPending}
                        onPress={submit}
                    />
                </>
            }
        >
            {failure === null ? null : conflict !== null ? (
                <Callout
                    testID="kitchen-order-desk-payment-conflict"
                    tone="warning"
                    role="alert"
                    title={t(
                        stale
                            ? 'kitchen:ops.orders.conflictTitle'
                            : 'kitchen:desk.recordPayment.cancelledTitle',
                    )}
                    body={t(
                        stale
                            ? 'kitchen:ops.orders.conflictBody'
                            : 'kitchen:desk.recordPayment.cancelledBody',
                    )}
                    actions={
                        stale ? (
                            <Button
                                testID="kitchen-order-desk-payment-conflict-refresh"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:ops.orders.conflictRefresh')}
                                loading={refreshing}
                                onPress={() => {
                                    record.reset();
                                    onRefresh();
                                }}
                            />
                        ) : undefined
                    }
                />
            ) : (
                <Text testID="kitchen-order-desk-payment-error" tone="danger" role="alert">
                    {failure.message}
                </Text>
            )}

            <Select<KitchenOrderPaymentMethod>
                testID="kitchen-order-desk-payment-method"
                id="kitchen-order-desk-payment-method"
                label={t('kitchen:desk.recordPayment.methodLabel')}
                hint={t('kitchen:desk.recordPayment.methodHint')}
                value={method}
                onChange={setMethod}
                options={KITCHEN_ORDER_PAYMENT_METHODS.map((candidate) => ({
                    value: candidate,
                    label: t(kitchenOrderPaymentMethodKey(candidate)),
                }))}
            />

            {/*
             * The wizard's own two sentences, from the wizard's own keys. A WISH transfer is
             * confirmed by a person looking at a telephone, and this platform checks nothing — a
             * second wording of that would be a second policy.
             */}
            {method === 'wish' ? (
                <Callout
                    testID="kitchen-order-desk-payment-wish-note"
                    tone="warning"
                    role="status"
                    title={t('kitchen:desk.sale.wishNoteTitle')}
                    body={t('kitchen:desk.sale.wishNoteBody')}
                />
            ) : null}

            <TextInputField
                testID="kitchen-order-desk-payment-amount"
                id="kitchen-order-desk-payment-amount"
                label={t('kitchen:desk.recordPayment.amountLabel', {
                    currency: row.currencyCode,
                })}
                hint={t('kitchen:desk.recordPayment.amountHint', {
                    outstanding: formatMoney(formatter, {
                        amount: outstandingMinor,
                        currency: row.currencyCode,
                    }),
                })}
                // Only once the person has actually typed something wrong: a field that opens
                // red because it is empty is a form telling somebody off for arriving.
                {...(amount.trim() !== '' && !amountValid
                    ? { error: t('kitchen:desk.recordPayment.amountInvalid') }
                    : {})}
                value={amount}
                onChangeText={setAmount}
                inputMode="decimal"
                autoCapitalize="none"
                autoCorrect={false}
            />

            <TextInputField
                testID="kitchen-order-desk-payment-reference"
                id="kitchen-order-desk-payment-reference"
                label={t('kitchen:desk.sale.referenceLabel')}
                hint={t(
                    // The same field carrying two different weights. On a transfer it is the only
                    // trace the money existed; on cash there is nothing to reference.
                    method === 'wish'
                        ? 'kitchen:desk.recordPayment.referenceHintWish'
                        : 'kitchen:desk.recordPayment.referenceHint',
                )}
                value={reference}
                onChangeText={setReference}
                autoCapitalize="none"
                autoCorrect={false}
            />

            <TextInputField
                testID="kitchen-order-desk-payment-notes"
                id="kitchen-order-desk-payment-notes"
                label={t('kitchen:desk.sale.notesLabel')}
                hint={t('kitchen:desk.recordPayment.notesHint')}
                value={notes}
                onChangeText={setNotes}
                multiline
            />
        </Dialog>
    );
}

export function OrderDeskScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_VIEW_PERMISSION] }}
            testID="kitchen-order-desk"
        >
            <OrderDeskQueueList />
        </Gate>
    );
}

/**
 * A clock that advances on the poll cadence.
 *
 * The due badge is the one thing on this screen that changes without the data changing, so something
 * has to move. It ticks with the poll rather than every second, for the reason the kitchen display's
 * own clock does: the label is minutes and hours, and re-rendering two hundred rows once a second to
 * say the same words is work a counter tablet pays for in battery and heat.
 *
 * Written here rather than imported from `kds-tickets-screen.tsx`: that module is a *screen*, and
 * importing a twelve-line hook out of it would pull the kitchen display, its queries and its
 * mutations into this slice's dependency graph. The write happens in the timer callback, never in
 * the effect body — same rule as `online/online-status.tsx`.
 */
function useTickingNow(intervalMs: number, running: boolean): Date {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => {
            setNow(new Date());
        }, intervalMs);
        return () => {
            clearInterval(timer);
        };
    }, [intervalMs, running]);

    return now;
}

function OrderDeskQueueList() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const toast = useToast();
    const { online } = useOnlineStatus();
    const canManage = useCan(ORDER_MANAGE_PERMISSION);

    const [deskWindow, setDeskWindow] = useState<OrderDeskWindow>('today');
    const [statuses, setStatuses] = useState<readonly OrderDeskQueueStatus[]>([]);
    /**
     * One kind of sale, or all three.
     *
     * A `Select` rather than the chip row beside it, and the difference is the wire's rather than a
     * styling choice: `statuses` is a *subset* filter — neither chip selected means both — while the
     * server takes exactly one fulfilment type or none. Chips here would offer a combination the
     * endpoint cannot express, and a screen that silently sent only the first would be worse than one
     * that never offered the choice.
     */
    const [fulfilmentType, setFulfilmentType] = useState<OrderDeskFulfilmentType | null>(null);
    const [query, setQuery] = useState('');
    /**
     * The row the record page was opened from, held rather than looked up by identifier.
     *
     * Fulfilling an order takes it out of the open queue, so a `rows.find(…)` alone would empty the
     * record page at the moment of success. This is the last known copy; {@link selectedRow} prefers the
     * live one whenever the queue still has it.
     */
    const [selected, setSelected] = useState<OrderDeskQueueRow | null>(null);
    /**
     * Whether the driver picker is open.
     *
     * A boolean rather than a held job: the dialog reads the run off {@link selectedRow}, which is
     * re-derived from the live queue on every poll — so a job that gained a driver, or a validator
     * that moved, is the one the confirmation sends. A copy taken at open time would be exactly the
     * stale version the endpoint exists to reject.
     */
    const [assigning, setAssigning] = useState(false);
    /**
     * Whether the receipt dialog is open.
     *
     * A boolean for {@link assigning}'s reason: the dialog reads the order off the *detail* query and
     * the money off {@link selectedRow}, both of which are re-derived as the poll lands, so what it
     * submits is the current validator against the current outstanding figure. A copy taken at open
     * time would be exactly the stale pair the precondition exists to reject.
     */
    const [recordingPayment, setRecordingPayment] = useState(false);

    const now = useTickingNow(ORDER_DESK_POLL_MS, online);
    const trimmed = query.trim();

    /**
     * One object, memoised, because it *is* the query key (query-key shape rule 3). An equal-but-new
     * object on every render would make every render a different cache entry — a refetch per
     * keystroke of a list the person is reading.
     */
    const filters = useMemo<OrderDeskQueueFilters>(
        () => ({
            window: deskWindow,
            ...(statuses.length === 0 ? {} : { statuses }),
            // Omitted rather than sent as a null: absent is what the server reads as "all three",
            // and a present-but-empty parameter would be the screen naming a field it has no value
            // for.
            ...(fulfilmentType === null ? {} : { fulfilmentType }),
            ...(trimmed === '' ? {} : { query: trimmed }),
        }),
        [deskWindow, statuses, fulfilmentType, trimmed],
    );

    const queue = useOrderDeskQueueQuery(filters, true, {
        // Offline, the interval stops: an interval firing into a dead network is retries nobody
        // asked for. Same gate as the kitchen display's.
        refetchInterval: online ? ORDER_DESK_POLL_MS : false,
    });

    /**
     * Memoised because {@link selectedRow} depends on it: `?? []` would mint a fresh empty array on
     * every render, and the record page would re-derive its row on every tick of the due clock.
     */
    const rows = useMemo<readonly OrderDeskQueueRow[]>(() => queue.data?.rows ?? [], [queue.data]);
    const meta = queue.data?.meta ?? null;
    const failure = toFailure(queue.error);

    /**
     * The open row as the queue currently has it, or the copy the record page was opened with.
     *
     * The fresh one while the order is still open — so a poll that lands a driver on the job updates
     * the record page under the agent's eyes — and the stale one once the order leaves the queue, which
     * is what fulfilling it does. Neither is a lock version: the transitions read the detail for
     * that.
     */
    const selectedRow = useMemo<OrderDeskQueueRow | null>(() => {
        if (selected === null) return null;
        return rows.find((row) => row.id === selected.id) ?? selected;
    }, [rows, selected]);

    const detail = useKitchenOrderQuery(selected?.id ?? null);
    const confirmOrder = useConfirmOrderMutation();
    const fulfilOrder = useFulfilOrderMutation();

    const order = detail.data ?? null;
    const detailFailure = toFailure(detail.error);
    const actionPending = confirmOrder.isPending || fulfilOrder.isPending;
    const actionFailure = toFailure(confirmOrder.error) ?? toFailure(fulfilOrder.error);
    const isConflict = actionFailure?.code === 'resource.conflict';

    function toggleStatus(status: OrderDeskQueueStatus, selected: boolean) {
        setStatuses((current) =>
            selected ? [...current, status] : current.filter((entry) => entry !== status),
        );
    }

    function clearFilters() {
        setDeskWindow('today');
        setStatuses([]);
        setFulfilmentType(null);
        setQuery('');
        controls.clearFilters();
    }

    function clearActionState() {
        confirmOrder.reset();
        fulfilOrder.reset();
    }

    function openDetail(row: OrderDeskQueueRow) {
        clearActionState();
        setSelected(row);
    }

    function closeDetail() {
        setSelected(null);
        setAssigning(false);
        setRecordingPayment(false);
        clearActionState();
    }

    function openAssign() {
        setAssigning(true);
    }

    /**
     * The money is written down. Say how much, and let the poll bring the row up to date.
     *
     * The toast is the announcement, on the same terms as {@link onAssigned}: it is the
     * application's own polite live region, so this is the mechanism every other write on this
     * surface already uses rather than a second one bolted on for a screen reader. The dialog closes
     * because the decision is made; the record page stays open on the order, which is what the person was
     * reading — and the invalidation the hook fires is what redraws the payment block underneath it.
     */
    function onPaymentRecorded(amount: string) {
        setRecordingPayment(false);
        toast.show({
            testID: 'kitchen-order-desk-payment-recorded-toast',
            tone: 'success',
            message: t('kitchen:desk.recordPayment.recordedToast', {
                amount,
                number: selectedRow?.orderNumber ?? order?.orderNumber ?? '',
            }),
        });
    }

    /**
     * The run has somebody. Say who, and let the poll bring the row up to date.
     *
     * The toast is the announcement — it is the application's own polite live region
     * (`design-system/src/overlays/toast.tsx`), so this is not a second mechanism bolted on for a
     * screen reader but the same one every other write on this surface uses. The dialog closes
     * because the decision is made; the record page stays open on the order, which is what the person
     * was reading.
     */
    function onAssigned(driverName: string) {
        setAssigning(false);
        toast.show({
            testID: 'kitchen-order-desk-assigned-toast',
            tone: 'success',
            message: t('kitchen:desk.assign.assignedToast', { name: driverName }),
        });
    }

    /**
     * Confirm or close, with the version the **detail** read answered.
     *
     * Never `selectedRow.lockVersion`: the row was rendered from a poll that may be fifteen seconds
     * old, and the point of re-reading the order is to hold a validator the server will still
     * accept.
     */
    function transition(action: 'confirm' | 'fulfil') {
        if (order === null) return;
        const request = { id: order.id, lockVersion: order.lockVersion };
        const onSuccess = (next: KitchenOrder) => {
            toast.show({
                testID: `kitchen-order-desk-${action}ed-toast`,
                tone: 'success',
                message: t(
                    action === 'confirm'
                        ? 'kitchen:ops.orders.confirmedToast'
                        : 'kitchen:ops.orders.fulfilledToast',
                    { number: next.orderNumber },
                ),
            });
        };
        if (action === 'confirm') confirmOrder.mutate(request, { onSuccess });
        else fulfilOrder.mutate(request, { onSuccess });
    }

    /*
     * The four figures, counted over the rows on screen.
     *
     * Over the *loaded* queue deliberately — it is bounded, not paged, so the rows are the whole
     * answer unless the truncation callout says otherwise, and a figure the list below could not
     * account for would be a figure nobody can check. Overdue reads the due clock the badges read, so
     * the count and the red badges can never disagree.
     */
    const overdueCount = rows.filter((row) => orderDeskDueTone(row.dueAt, now) === 'danger').length;
    const lateCount = rows.filter((row) => Date.parse(row.dueAt) < now.getTime()).length;
    const needsDriverCount = rows.filter(
        (row) => orderDeskDeliveryState(row) === 'unassigned',
    ).length;
    const unsettledCount = rows.filter((row) => !row.payment.receipted).length;

    const figures: readonly CatalogueStatCard[] = [
        {
            key: 'open',
            label: t('kitchen:desk.figures.open'),
            value: formatter.formatNumber(rows.length),
            caption: t('kitchen:desk.figures.openCaption'),
            mark: 'calendar',
            tone: 'brand',
        },
        {
            key: 'late',
            label: t('kitchen:desk.figures.late'),
            value: formatter.formatNumber(lateCount),
            caption: t('kitchen:desk.figures.lateCaption'),
            mark: 'warning',
            tone: overdueCount > 0 ? 'danger' : 'default',
        },
        {
            key: 'needsDriver',
            label: t('kitchen:desk.delivery.unassigned'),
            value: formatter.formatNumber(needsDriverCount),
            caption: t('kitchen:desk.figures.needsDriverCaption'),
            mark: 'user',
            tone: needsDriverCount > 0 ? 'warning' : 'default',
        },
        {
            key: 'unsettled',
            label: t('kitchen:desk.payment.notReceipted'),
            value: formatter.formatNumber(unsettledCount),
            caption: t('kitchen:desk.figures.unsettledCaption'),
            mark: 'basket',
        },
    ];

    const columns: readonly ControlledColumn<
        OrderDeskQueueRow,
        CatalogueColumn<OrderDeskQueueRow>
    >[] = [
        {
            key: 'number',
            role: 'title',
            value: (row) => row.orderNumber,
            label: t('kitchen:desk.columnNumber'),
            width: 120,
            priority: 100,
            sort: (left, right, direction) =>
                compareText(left.orderNumber, right.orderNumber, direction),
            mono: true,
            render: (row) => (
                <Text variant="mono" testID={`${orderDeskRowTestId(String(row.id))}-number`}>
                    {row.orderNumber}
                </Text>
            ),
        },
        {
            key: 'customer',
            label: t('kitchen:desk.columnCustomer'),
            width: 150,
            priority: 90,
            sort: (left, right, direction) =>
                compareText(left.customer?.displayName, right.customer?.displayName, direction),
            render: (row) => {
                // Absent block and null name are one cell here on purpose — see the file header.
                const name = row.customer?.displayName ?? null;
                return (
                    <Text
                        variant="strong"
                        tone={name === null ? 'secondary' : 'primary'}
                        testID={`${orderDeskRowTestId(String(row.id))}-customer`}
                        {...(name === null
                            ? { accessibilityLabel: t('kitchen:desk.a11y.noCustomerName') }
                            : {})}
                    >
                        {name ?? EM_DASH}
                    </Text>
                );
            },
        },
        {
            key: 'phone',
            label: t('kitchen:desk.columnPhone'),
            width: 120,
            priority: 50,
            sort: (left, right, direction) =>
                compareText(left.customer?.phone, right.customer?.phone, direction),
            render: (row) =>
                row.customer?.phone == null ? (
                    <Text tone="secondary">{EM_DASH}</Text>
                ) : (
                    <Text
                        variant="mono"
                        tone="secondary"
                        testID={`${orderDeskRowTestId(String(row.id))}-customer-phone`}
                    >
                        {row.customer.phone}
                    </Text>
                ),
        },
        {
            key: 'due',
            label: t('kitchen:desk.columnDue'),
            width: 64,
            priority: 88,
            sort: (left, right, direction) =>
                compareNumber(Date.parse(left.dueAt), Date.parse(right.dueAt), direction),
            render: (row) => (
                <Text variant="mono" testID={`${orderDeskRowTestId(String(row.id))}-due`}>
                    {formatter.formatDate(row.dueAt, { timeStyle: 'short' })}
                </Text>
            ),
        },
        {
            key: 'ageing',
            label: t('kitchen:desk.columnAgeing'),
            width: 110,
            priority: 92,
            // How late an order is *is* its due time read against now, so it sorts the same way.
            sort: (left, right, direction) =>
                compareNumber(Date.parse(left.dueAt), Date.parse(right.dueAt), direction),
            render: (row) => <DueBadge row={row} now={now} />,
        },
        {
            key: 'kind',
            label: t('kitchen:desk.filterTypeLabel'),
            width: 90,
            priority: 60,
            // The same server-side filter as the toolbar's kind select, reached from the column.
            filter: {
                values: () =>
                    ORDER_DESK_FULFILMENT_TYPES.map((candidate) => ({
                        key: candidate,
                        label: t(kitchenOrderFulfilmentTypeKey(candidate)),
                    })),
                external: {
                    value: fulfilmentType,
                    onChange: (next) => {
                        setFulfilmentType(next as OrderDeskFulfilmentType | null);
                    },
                },
            },
            render: (row) => (
                <Text tone="secondary" testID={`${orderDeskRowTestId(String(row.id))}-kind`}>
                    {t(kitchenOrderFulfilmentTypeKey(row.fulfilmentType))}
                </Text>
            ),
        },
        {
            key: 'payment',
            label: t('kitchen:desk.columnPayment'),
            width: 150,
            priority: 75,
            filter: {
                values: () =>
                    KITCHEN_ORDER_PAYMENT_METHODS.map((candidate) => ({
                        key: candidate,
                        label: t(kitchenOrderPaymentMethodKey(candidate)),
                    })),
                match: (row, value) => row.payment.method === value,
            },
            render: (row) => <PaymentCell row={row} />,
        },
        {
            key: 'total',
            role: 'metric',
            label: t('kitchen:desk.columnTotal'),
            width: 100,
            priority: 85,
            sort: (left, right, direction) =>
                compareNumber(left.totalMinor, right.totalMinor, direction),
            align: 'end',
            mono: true,
            render: (row) => (
                <Text variant="mono" testID={`${orderDeskRowTestId(String(row.id))}-total`}>
                    {formatMoney(formatter, { amount: row.totalMinor, currency: row.currencyCode })}
                </Text>
            ),
        },
    ];

    /*
     * Header sort and filter, through the shared hook. In memory, which is honest here in a way it
     * is not on a paged catalogue: the queue is *bounded, not paged* — the rows are the whole answer,
     * and when the server capped the read the truncation callout already says so. Kind is the
     * exception: its header drives the same `fulfilmentType` the toolbar select sends to the server.
     * With no header pressed the rows keep the server's due-time order.
     */
    const controls = useColumnControls(rows, columns, 'kitchen-order-desk');

    const filtered =
        trimmed !== '' ||
        statuses.length > 0 ||
        fulfilmentType !== null ||
        deskWindow !== 'today' ||
        controls.filtered;

    /**
     * The page, remembered against what it was chosen under — so narrowing the queue lands on page
     * one without an effect, and a poll that shortens the queue clamps rather than empties.
     */
    const pagingKey = useMemo(() => ({ filters, controls: controls.key }), [filters, controls.key]);
    const [paging, setPaging] = useState<{
        readonly key: typeof pagingKey;
        readonly page: number;
    }>({ key: pagingKey, page: 1 });
    const totalPages = Math.max(1, Math.ceil(controls.rows.length / PAGE_SIZE));
    const page = paging.key === pagingKey ? Math.min(paging.page, totalPages) : 1;
    const pageRows = controls.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    /*
     * The two dialogs, outside the record page's cards: a modal mounted inside a scrolling surface is
     * a focus trap fighting the surface's.
     */
    const dialogs = (
        <>
            {/*
             * Outside the record page rather than inside it: the record page's body scrolls, and a modal
             * mounted inside a scrolling panel is a modal whose focus trap fights the panel's.
             *
             * **Mounted only while it is open**, which is what gives every opening a clean sheet —
             * no stale search text, no refusal from the previous order — without an effect that
             * resets four pieces of state and re-renders to do it. It reads the job off
             * `selectedRow`, the live queue row, so the validator it sends is the current one.
             */}
            {assigning && selectedRow?.deliveryJob != null ? (
                <AssignDriverDialog
                    job={selectedRow.deliveryJob}
                    orderNumber={selectedRow.orderNumber}
                    onClose={() => {
                        setAssigning(false);
                    }}
                    onAssigned={onAssigned}
                    onRefresh={() => {
                        void queue.refetch();
                    }}
                    refreshing={queue.isFetching}
                />
            ) : null}

            {/*
             * Outside the record page for the assign dialog's reason — a modal mounted inside a scrolling
             * panel is a focus trap fighting the panel's — and mounted only while open, which is
             * what gives every opening a clean sheet without an effect that resets four fields.
             *
             * It needs **both**: the order for the validator it sends, and the row for the money it
             * prefills, because the detail endpoint serves no payment position at all.
             */}
            {recordingPayment && order !== null && selectedRow !== null ? (
                <RecordPaymentDialog
                    order={order}
                    row={selectedRow}
                    onClose={() => {
                        setRecordingPayment(false);
                    }}
                    onRecorded={onPaymentRecorded}
                    onRefresh={() => {
                        clearActionState();
                        void detail.refetch();
                        void queue.refetch();
                    }}
                    refreshing={detail.isFetching || queue.isFetching}
                />
            ) : null}
        </>
    );

    /*
     * The order, as the record page every kitchen View opens — in place of the queue, so Back is a
     * state change and the window, chips, search, sort and page are all still here when it lands.
     *
     * It used to be a 372px drawer over the queue. The page gives the lines and the money the width
     * of the content, puts the lifecycle action where every other record keeps its one action, and
     * is the shape a reader already knows from Orders and the catalogue.
     *
     * The heading and the customer card are drawn from the queue row at once — the row *is* a
     * `KitchenOrder` — and everything that needs the re-read order (the lines, the money, the run and
     * the lifecycle action with the version it sends) arrives with the detail.
     */
    if (selectedRow !== null) {
        const shown = order ?? selectedRow;
        const lifecycle =
            order === null || !canManage
                ? undefined
                : canConfirmKitchenOrder(order.status)
                  ? ('confirm' as const)
                  : canFulfilKitchenOrder(order.status)
                    ? ('fulfil' as const)
                    : undefined;

        return (
            <>
                <RecordViewPage
                    testID="kitchen-order-desk-view"
                    onBack={closeDetail}
                    title={t('kitchen:ops.orders.detailTitle', { number: selectedRow.orderNumber })}
                    kind={t('kitchen:desk.drawerKind', {
                        type: t(kitchenOrderFulfilmentTypeKey(shown.fulfilmentType)),
                    })}
                    status={{
                        label: t(kitchenOrderStatusKey(shown.status)),
                        tone: kitchenOrderStatusTone(shown.status),
                    }}
                    titleAside={
                        <Inline space="xs" align="center">
                            <DueBadge row={selectedRow} now={now} />
                            <Text variant="mono" tone="secondary">
                                {t('kitchen:desk.dueAt', {
                                    time: formatter.formatDate(selectedRow.dueAt, {
                                        timeStyle: 'short',
                                    }),
                                })}
                            </Text>
                        </Inline>
                    }
                    fieldsTitle={t('kitchen:desk.columnCustomer')}
                    fields={[
                        {
                            key: 'customer',
                            label: t('kitchen:desk.columnCustomer'),
                            value: selectedRow.customer?.displayName ?? EM_DASH,
                        },
                        {
                            key: 'phone',
                            label: t('kitchen:desk.columnPhone'),
                            value: selectedRow.customer?.phone ?? EM_DASH,
                            mono: true,
                        },
                        ...(shown.fulfilmentType === 'delivery'
                            ? [
                                  {
                                      key: 'area',
                                      label: t('kitchen:desk.drawerArea'),
                                      value: shown.delivery.areaNameEn ?? EM_DASH,
                                  },
                                  {
                                      key: 'address',
                                      label: t('kitchen:desk.drawerAddress'),
                                      value:
                                          [shown.delivery.lineOne, shown.delivery.lineTwo]
                                              .filter((part): part is string => part !== null)
                                              .join(', ') || EM_DASH,
                                  },
                              ]
                            : []),
                        {
                            key: 'slot',
                            label: t('kitchen:desk.columnSlot'),
                            value:
                                shown.delivery.windowCode === null
                                    ? t('kitchen:desk.noSlot')
                                    : humaniseCode(shown.delivery.windowCode),
                        },
                    ]}
                    sections={
                        detail.isPending
                            ? [
                                  {
                                      key: 'loading',
                                      title: t('kitchen:ops.orders.linesHeading'),
                                      content: (
                                          <Skeleton
                                              testID="kitchen-order-desk-detail-loading"
                                              heightClassName="h-40"
                                          />
                                      ),
                                  },
                              ]
                            : detailFailure !== null
                              ? [
                                    {
                                        key: 'error',
                                        title: t('kitchen:ops.orders.linesHeading'),
                                        content: (
                                            <ErrorState
                                                testID="kitchen-order-desk-detail-error"
                                                title={t('kitchen:ops.orders.detailLoadErrorTitle')}
                                                failure={detailFailure}
                                                onRetry={() => {
                                                    void detail.refetch();
                                                }}
                                                retrying={detail.isFetching}
                                            />
                                        ),
                                    },
                                ]
                              : order === null
                                ? []
                                : [
                                      {
                                          key: 'lines',
                                          title: t('kitchen:ops.orders.linesHeading'),
                                          content:
                                              (
                                                  /*
                                                   * `-body` marks the moment the re-read order has
                                                   * landed. No pressable rows: every control on this
                                                   * page is a section action or the status card's, so
                                                   * nothing nests one interactive element in another.
                                                   */
                                                  <View
                                                      testID="kitchen-order-desk-detail-body"
                                                      className="flex-col"
                                                  >
                                                      <View
                                                          testID="kitchen-order-desk-detail-lines"
                                                          className="flex-col"
                                                      >
                                                          {order.lines.map(
                                                              (line: KitchenOrderLine) => (
                                                                  <View
                                                                      key={line.id}
                                                                      className="flex-row items-baseline gap-tight border-b border-stroke-subtle py-tight"
                                                                  >
                                                                      {/* eslint-disable-next-line no-restricted-syntax -- the line name is the row's filler. */}
                                                                      <View className="min-w-0 flex-1">
                                                                          <Text variant="label">
                                                                              {line.nameEn}
                                                                          </Text>
                                                                          {line.variantLabel ===
                                                                          null ? null : (
                                                                              <Text
                                                                                  variant="caption"
                                                                                  tone="secondary"
                                                                              >
                                                                                  {
                                                                                      line.variantLabel
                                                                                  }
                                                                              </Text>
                                                                          )}
                                                                      </View>
                                                                      <Text
                                                                          variant="mono"
                                                                          tone="secondary"
                                                                      >
                                                                          {t(
                                                                              'kitchen:desk.lineQuantity',
                                                                              {
                                                                                  quantity:
                                                                                      formatter.formatNumber(
                                                                                          Number(
                                                                                              line.quantity,
                                                                                          ),
                                                                                      ),
                                                                              },
                                                                          )}
                                                                      </Text>
                                                                      <Text variant="mono">
                                                                          {formatMoney(formatter, {
                                                                              amount: line.lineTotalMinor,
                                                                              currency:
                                                                                  line.currencyCode,
                                                                          })}
                                                                      </Text>
                                                                  </View>
                                                              ),
                                                          )}
                                                      </View>
                                                      <View
                                                          testID="kitchen-order-desk-detail-totals"
                                                          className="flex-col gap-hair pt-tight"
                                                      >
                                                          <DeskAmount
                                                              label={t(
                                                                  'kitchen:ops.orders.subtotal',
                                                              )}
                                                              testID="kitchen-order-desk-detail-subtotal"
                                                              value={formatMoney(formatter, {
                                                                  amount: order.subtotalMinor,
                                                                  currency: order.currencyCode,
                                                              })}
                                                          />
                                                          <DeskAmount
                                                              label={t(
                                                                  'kitchen:ops.orders.deliveryFee',
                                                              )}
                                                              testID="kitchen-order-desk-detail-delivery-fee"
                                                              // `null` is not zero: a free delivery and a collection that
                                                              // never had a fee are different facts.
                                                              value={
                                                                  order.deliveryFeeMinor === null
                                                                      ? t(
                                                                            'kitchen:ops.orders.noDeliveryFee',
                                                                        )
                                                                      : formatMoney(formatter, {
                                                                            amount: order.deliveryFeeMinor,
                                                                            currency:
                                                                                order.currencyCode,
                                                                        })
                                                              }
                                                          />
                                                          <DeskAmount
                                                              emphasis
                                                              label={t('kitchen:ops.orders.total')}
                                                              testID="kitchen-order-desk-detail-total"
                                                              value={formatMoney(formatter, {
                                                                  amount: order.totalMinor,
                                                                  currency: order.currencyCode,
                                                              })}
                                                          />
                                                      </View>
                                                  </View>
                                              ),
                                      },
                                      {
                                          key: 'payment',
                                          title: t('kitchen:desk.paymentHeading'),
                                          content: (
                                              <View
                                                  testID="kitchen-order-desk-detail-payment"
                                                  className="flex-col"
                                              >
                                                  <DeskFact
                                                      testID="kitchen-order-desk-detail-payment-method"
                                                      label={t('kitchen:desk.paymentMethod')}
                                                      value={t(
                                                          kitchenOrderPaymentMethodKey(
                                                              selectedRow?.payment.method ??
                                                                  order.paymentMethod,
                                                          ),
                                                      )}
                                                  />
                                                  {/*
                                                   * The receipt figures come from the queue row, because the detail
                                                   * endpoint does not serve them: an order read on its own says what was
                                                   * *intended*, and what has actually arrived is the queue's own column.
                                                   */}
                                                  {selectedRow === null ? null : (
                                                      <>
                                                          <DeskFact
                                                              testID="kitchen-order-desk-detail-payment-received"
                                                              label={t(
                                                                  'kitchen:desk.paymentReceived',
                                                              )}
                                                              mono
                                                              value={formatMoney(formatter, {
                                                                  amount: selectedRow.payment
                                                                      .receivedMinor,
                                                                  currency:
                                                                      selectedRow.currencyCode,
                                                              })}
                                                          />
                                                          <DeskFact
                                                              testID="kitchen-order-desk-detail-payment-state"
                                                              label={t('kitchen:desk.paymentState')}
                                                              value={t(
                                                                  selectedRow.payment.receipted
                                                                      ? 'kitchen:desk.payment.receipted'
                                                                      : 'kitchen:desk.payment.notReceipted',
                                                              )}
                                                          />
                                                      </>
                                                  )}
                                                  <View className="flex-row pt-tight">
                                                      {
                                                          /*
                                                           * Offered while there is still something to collect, and not
                                                           * otherwise. Three conditions, each ruling out a different
                                                           * order:
                                                           *
                                                           * - `receipted` — a settled order needs nothing written down,
                                                           *   and an over-payment is not corrected by a second receipt
                                                           *   (giving money back is a refund, which is not this ledger).
                                                           * - `cancelled` — the server refuses it with a `409` that
                                                           *   carries no version, so offering the button would be
                                                           *   offering a wall to walk into.
                                                           * - `canManage` — recording money is managing the order, on the
                                                           *   same code the lifecycle buttons and the driver assignment
                                                           *   take.
                                                           *
                                                           * A counter sale never reaches this record page: it arrives already
                                                           * fulfilled and settled, so it is not in the open queue at all.
                                                           */
                                                          selectedRow === null ||
                                                          selectedRow.payment.receipted ||
                                                          order.status === 'cancelled' ||
                                                          !canManage ? undefined : (
                                                              <Button
                                                                  testID="kitchen-order-desk-detail-record-payment"
                                                                  size="sm"
                                                                  variant="ghost"
                                                                  label={t(
                                                                      'kitchen:desk.recordPayment.open',
                                                                  )}
                                                                  onPress={() => {
                                                                      setRecordingPayment(true);
                                                                  }}
                                                              />
                                                          )
                                                      }
                                                  </View>
                                              </View>
                                          ),
                                      },
                                      /*
                                       * The run, and only for an order that has one to have. A
                                       * pickup showing an empty "The run" card would be a heading
                                       * about nothing.
                                       */
                                      ...(orderDeskDeliveryState(selectedRow) === 'not_delivered'
                                          ? []
                                          : [
                                                {
                                                    key: 'delivery',
                                                    title: t('kitchen:desk.deliveryHeading'),
                                                    content: (
                                                        <View
                                                            testID="kitchen-order-desk-detail-delivery"
                                                            className="flex-col"
                                                        >
                                                            <DeskFact
                                                                testID="kitchen-order-desk-detail-delivery-state"
                                                                label={t(
                                                                    'kitchen:desk.deliveryState',
                                                                )}
                                                                value={t(
                                                                    orderDeskDeliveryStateKey(
                                                                        orderDeskDeliveryState(
                                                                            selectedRow,
                                                                        ),
                                                                    ),
                                                                )}
                                                            />
                                                            {selectedRow.deliveryJob ===
                                                            null ? null : (
                                                                <>
                                                                    <DeskFact
                                                                        testID="kitchen-order-desk-detail-delivery-status"
                                                                        label={t(
                                                                            'kitchen:desk.deliveryStatus',
                                                                        )}
                                                                        value={t(
                                                                            deliveryJobStatusKey(
                                                                                selectedRow
                                                                                    .deliveryJob
                                                                                    .status,
                                                                            ),
                                                                        )}
                                                                    />
                                                                    <DeskFact
                                                                        testID="kitchen-order-desk-detail-delivery-tracking"
                                                                        label={t(
                                                                            'kitchen:desk.deliveryTracking',
                                                                        )}
                                                                        value={t(
                                                                            deliveryJobTrackingKey(
                                                                                selectedRow
                                                                                    .deliveryJob
                                                                                    .trackingStatus,
                                                                            ),
                                                                        )}
                                                                    />
                                                                    <DeskFact
                                                                        testID="kitchen-order-desk-detail-delivery-assigned-at"
                                                                        label={t(
                                                                            'kitchen:desk.deliveryAssignedAt',
                                                                        )}
                                                                        // Null on a run nobody has taken — which the state row
                                                                        // above has already said in words.
                                                                        value={
                                                                            selectedRow.deliveryJob
                                                                                .assignedAt === null
                                                                                ? t(
                                                                                      'kitchen:common.notRecorded',
                                                                                  )
                                                                                : formatter.formatDate(
                                                                                      selectedRow
                                                                                          .deliveryJob
                                                                                          .assignedAt,
                                                                                  )
                                                                        }
                                                                    />
                                                                </>
                                                            )}
                                                            <View className="flex-row pt-tight">
                                                                {
                                                                    /*
                                                                     * `canManage` gates it on the same code the lifecycle
                                                                     * buttons take: choosing whose evening this is, is managing
                                                                     * the order rather than reading it.
                                                                     */
                                                                    selectedRow.deliveryJob ===
                                                                        null ||
                                                                    !canManage ||
                                                                    !canAssignDeliveryJob(
                                                                        selectedRow.deliveryJob
                                                                            .status,
                                                                    ) ? undefined : (
                                                                        <Button
                                                                            testID="kitchen-order-desk-detail-assign"
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            label={t(
                                                                                selectedRow
                                                                                    .deliveryJob
                                                                                    .driverUserId ===
                                                                                    null
                                                                                    ? 'kitchen:desk.assign.open'
                                                                                    : 'kitchen:desk.assign.reopen',
                                                                            )}
                                                                            onPress={() => {
                                                                                openAssign();
                                                                            }}
                                                                        />
                                                                    )
                                                                }
                                                            </View>
                                                        </View>
                                                    ),
                                                },
                                            ]),
                                  ]
                    }
                    statusContent={
                        order === null ? undefined : (
                            <>
                                {/*
                                 * The driver's own axis, above the button that closes the order
                                 * rather than instead of it. The desk is not blocked on a delivery
                                 * stamp — see the file header — so this is what makes the close an
                                 * informed one.
                                 */}
                                {lifecycle !== 'fulfil' ||
                                selectedRow.deliveryJob === null ? null : (
                                    <View className="flex-row flex-wrap items-baseline gap-hair">
                                        <Text variant="caption" tone="secondary">
                                            {t('kitchen:desk.driverSays')}
                                        </Text>
                                        <Text
                                            variant="caption"
                                            tone="primary"
                                            testID="kitchen-order-desk-detail-fulfil-tracking"
                                        >
                                            {t(
                                                deliveryJobTrackingKey(
                                                    selectedRow.deliveryJob.trackingStatus,
                                                ),
                                            )}
                                        </Text>
                                    </View>
                                )}
                                {actionFailure === null ? null : isConflict ? (
                                    // Somebody else moved this order. The remedy is to re-read and show
                                    // what actually happened — never a silent retry, which would resolve
                                    // the race in favour of whoever clicked last.
                                    <Callout
                                        testID="kitchen-order-desk-detail-conflict"
                                        tone="warning"
                                        role="alert"
                                        title={t('kitchen:ops.orders.conflictTitle')}
                                        body={t('kitchen:ops.orders.conflictBody')}
                                        actions={
                                            <Button
                                                testID="kitchen-order-desk-detail-conflict-refresh"
                                                size="sm"
                                                variant="secondary"
                                                label={t('kitchen:ops.orders.conflictRefresh')}
                                                loading={detail.isFetching}
                                                onPress={() => {
                                                    clearActionState();
                                                    void detail.refetch();
                                                    void queue.refetch();
                                                }}
                                            />
                                        }
                                    />
                                ) : (
                                    <Text
                                        testID="kitchen-order-desk-detail-action-error"
                                        tone="danger"
                                    >
                                        {actionFailure.message}
                                    </Text>
                                )}
                            </>
                        )
                    }
                    primaryAction={
                        lifecycle === undefined
                            ? undefined
                            : {
                                  label: t(
                                      lifecycle === 'confirm'
                                          ? 'kitchen:ops.orders.confirm'
                                          : 'kitchen:ops.orders.fulfil',
                                  ),
                                  icon: null,
                                  testID: `kitchen-order-desk-detail-${lifecycle}`,
                                  loading:
                                      lifecycle === 'confirm'
                                          ? confirmOrder.isPending
                                          : fulfilOrder.isPending,
                                  disabled: actionPending,
                                  onPress: () => {
                                      transition(lifecycle);
                                  },
                              }
                    }
                />
                {dialogs}
            </>
        );
    }

    return (
        <Stack space="md" testID="kitchen-order-desk-screen">
            {/*
             * No title, no summary line: the shell's trail names the page, and the four cards are
             * the figures — the ingredients screen's opening, for the same reasons.
             */}
            {queue.isPending ? null : (
                <CatalogueStatCards testID="kitchen-order-desk-figures" cards={figures} />
            )}

            {/*
             * One row of 28px controls. Two filters on it look alike and are not: the status chips
             * are a *subset* filter — neither selected means both — while the kind of sale is a
             * single choice because the endpoint takes exactly one value or none. See the file
             * header.
             *
             * `z-tooltip` because React Native Web gives every view its own stacking context: the
             * kind picker's panel would otherwise paint under the table that follows the row.
             */}
            <View
                testID="kitchen-order-desk-toolbar"
                className="z-tooltip min-h-control-sm flex-row flex-wrap items-center gap-tight"
            >
                {/* eslint-disable-next-line no-restricted-syntax -- the search takes the row's leftover width. */}
                <View className="flex-1" style={{ minWidth: SEARCH_MIN_WIDTH }}>
                    <SearchInput
                        testID="kitchen-order-desk-search"
                        label={t('kitchen:desk.searchLabel')}
                        placeholder={t('kitchen:desk.searchPlaceholder')}
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </View>

                <SegmentedControl<OrderDeskWindow>
                    testID="kitchen-order-desk-window"
                    label={t('kitchen:desk.windowLabel')}
                    value={deskWindow}
                    onChange={setDeskWindow}
                    items={ORDER_DESK_WINDOWS.map((candidate) => ({
                        value: candidate,
                        label: t(WINDOW_LABEL_KEYS[candidate]),
                        testID: `kitchen-order-desk-window-${candidate}`,
                    }))}
                />

                <View
                    testID="kitchen-order-desk-status"
                    role="group"
                    aria-label={t('kitchen:desk.statusLabel')}
                    className="flex-row items-center gap-hair"
                >
                    {ORDER_DESK_QUEUE_STATUSES.map((candidate) => (
                        <FilterChip
                            key={candidate}
                            size="sm"
                            testID={`kitchen-order-desk-status-${candidate}`}
                            label={t(kitchenOrderStatusKey(candidate))}
                            selected={statuses.includes(candidate)}
                            onChange={(selected) => {
                                toggleStatus(candidate, selected);
                            }}
                        />
                    ))}
                </View>

                <View className="z-tooltip" style={{ width: KIND_WIDTH }}>
                    <Select<OrderDeskFulfilmentType | typeof ANY_FULFILMENT_TYPE>
                        testID="kitchen-order-desk-type"
                        id="kitchen-order-desk-type"
                        label={t('kitchen:desk.filterTypeLabel')}
                        labelHidden
                        value={fulfilmentType ?? ANY_FULFILMENT_TYPE}
                        onChange={(next) => {
                            setFulfilmentType(next === ANY_FULFILMENT_TYPE ? null : next);
                        }}
                        options={[
                            {
                                value: ANY_FULFILMENT_TYPE,
                                label: t('kitchen:desk.filterTypeAll'),
                            },
                            ...ORDER_DESK_FULFILMENT_TYPES.map((candidate) => ({
                                value: candidate,
                                // The wizard's own labels, through the shared table — translating
                                // "Collection" twice would eventually produce two translations of
                                // it.
                                label: t(kitchenOrderFulfilmentTypeKey(candidate)),
                            })),
                        ]}
                    />
                </View>

                {filtered ? (
                    <Button
                        testID="kitchen-order-desk-toolbar-clear"
                        size="sm"
                        variant="ghost"
                        label={t('kitchen:desk.clearFilters')}
                        onPress={clearFilters}
                    />
                ) : null}

                {/* The page's one primary, at the end of the row the queue is worked from. */}
                <Button
                    testID="kitchen-order-desk-new-sale"
                    label={t('kitchen:desk.newSale')}
                    iconStart={<Icon name="plus" size="sm" />}
                    onPress={() => {
                        router.push('/kitchen/order-desk/sale');
                    }}
                />
            </View>

            {/*
             * Offline, the poll stops (see the query options above) and the rows on screen are the
             * last copy that arrived. Said once, at the top, so an agent does not quote a driver's
             * position that stopped updating five minutes ago.
             */}
            {online ? null : (
                <Callout
                    testID="kitchen-order-desk-offline"
                    tone="warning"
                    role="status"
                    icon="offline"
                    title={t('kitchen:desk.offlineTitle')}
                    body={t('kitchen:desk.offlineBody')}
                />
            )}

            {queue.isPending ? (
                <View testID="kitchen-order-desk-loading" className="flex-col">
                    {Array.from({ length: 8 }, (_, index) => (
                        <View
                            key={index}
                            className="h-row-md flex-row items-center border-b border-stroke-subtle"
                        >
                            <Skeleton
                                testID={`kitchen-order-desk-skeleton-${String(index + 1)}`}
                                heightClassName="h-2"
                            />
                        </View>
                    ))}
                </View>
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-order-desk-error"
                    title={t('kitchen:desk.loadErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void queue.refetch();
                    }}
                    retrying={queue.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="kitchen-order-desk-empty"
                    title={t(
                        filtered ? 'kitchen:desk.filteredEmptyTitle' : 'kitchen:desk.emptyTitle',
                    )}
                    body={t(filtered ? 'kitchen:desk.filteredEmptyBody' : 'kitchen:desk.emptyBody')}
                    actions={
                        <Inline space="xs" wrap>
                            {filtered ? (
                                <Button
                                    testID="kitchen-order-desk-clear"
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:desk.clearFilters')}
                                    onPress={clearFilters}
                                />
                            ) : null}
                            <Button
                                testID="kitchen-order-desk-empty-new-sale"
                                size="sm"
                                label={t('kitchen:desk.newSale')}
                                onPress={() => {
                                    router.push('/kitchen/order-desk/sale');
                                }}
                            />
                        </Inline>
                    }
                />
            ) : (
                <Stack space="sm">
                    {meta?.truncated === true ? (
                        // A silent truncation would hide exactly the backlog this queue exists to
                        // surface, and there is no second page to offer instead — so the cap is
                        // stated, with the three ways to get under it.
                        <Callout
                            testID="kitchen-order-desk-truncated"
                            tone="info"
                            role="status"
                            title={t('kitchen:desk.truncatedTitle', { limit: meta.limit })}
                            body={t('kitchen:desk.truncatedBody')}
                        />
                    ) : null}

                    {/*
                     * Opens on the server's due-time order. Order, Customer, Telephone, Due and
                     * Total sort on a press; Kind, Delivery and Payment filter from their menus.
                     */}
                    <CatalogueList<OrderDeskQueueRow>
                        testID="kitchen-order-desk-table"
                        label={t('kitchen:desk.caption')}
                        columns={controls.columns}
                        rows={pageRows}
                        rowKey={(row) => String(row.id)}
                        density="sm"
                        onRowPress={openDetail}
                        rowActionsLabel={t('kitchen:list.rowActions')}
                        // The row itself opens the order; this is the same action as a named,
                        // focusable control — the eye every kitchen list draws for View — so a
                        // keyboard user has a target that says what pressing it does.
                        rowActions={(row): readonly MenuItem[] => [
                            {
                                key: 'view',
                                label: t('kitchen:list.view'),
                                icon: CATALOGUE_ROW_ICONS.view,
                                testID: `${orderDeskRowTestId(String(row.id))}-view`,
                                onSelect: () => {
                                    openDetail(row);
                                },
                            },
                        ]}
                    />

                    <CataloguePager
                        testID="kitchen-order-desk-pagination"
                        range={t('kitchen:toolbar.showing', {
                            shown: pageRows.length,
                            total: rows.length,
                        })}
                        page={page}
                        totalPages={totalPages}
                        onPageChange={(next) => {
                            setPaging({ key: pagingKey, page: next });
                        }}
                        label={t('kitchen:catalogue.pagerLabel')}
                    />
                </Stack>
            )}
        </Stack>
    );
}
