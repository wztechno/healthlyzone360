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
    Card,
    Dialog,
    Drawer,
    EmptyState,
    ErrorState,
    FilterChip,
    Heading,
    Icon,
    Inline,
    SegmentedControl,
    Select,
    Skeleton,
    Stack,
    Table,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    orderDeskDeliveryStateTone,
    orderDeskDueTone,
    orderDeskRowTestId,
} from '../ops-format.ts';

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
 * ## The drawer re-reads the order it was opened from — and keeps the row it was opened from
 *
 * Two reads, and each answers something the other cannot. The **detail** read
 * (`useKitchenOrderQuery`) is what the transitions send `If-Match` from: the version a queue row was
 * rendered from can be a poll or two old, and sending it would earn a `resource.conflict` the person
 * did nothing to deserve. This is `orders-screen.tsx`'s rule, and the write responses are seeded
 * straight back into that entry by the hook, which is what lets "Fulfil" fire immediately after
 * "Confirm" with a version the server will accept.
 *
 * The **row** is kept because the detail endpoint does not serve a delivery job or a payment
 * position at all — those live only on the queue's own row. So the drawer holds the row it was
 * opened from and re-reads it out of the live queue on every poll, falling back to the last known
 * copy when the order leaves the queue (which is exactly what fulfilling it does). A drawer that
 * dropped its delivery block the instant the agent closed the order would look like a fault.
 *
 * ## Closing is offered on evidence, not gated on it
 *
 * "Fulfil" means *the customer has it*, and on a delivery the only evidence of that is the driver's
 * own stamp — which arrives on the job's tracking axis, minutes after it happened, and sometimes not
 * at all when a phone is in a pocket in a lift. So the desk is **not blocked** on
 * `tracking_status === 'delivered'`: an agent on the telephone to a customer who has the food in
 * their hands knows something the board does not. What the drawer does instead is put the tracking
 * status *beside* the button, so the close is made informed rather than blind.
 *
 * A counter sale never reaches this drawer needing anything: it arrives already `fulfilled` and
 * therefore is not in the open queue at all.
 *
 * ## The delivery column, and the assignment that finally has a picker
 *
 * The column reads {@link orderDeskDeliveryState} — five states, four of which this queue meets
 * often (see `ops-format.ts` for what each one means and why none collapses into another).
 *
 * The drawer now offers **Assign**, and the reason it did not for a whole slice is worth keeping:
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
 * ## Money is recorded from the drawer, and it is the only write here that changes nothing
 *
 * A counter sale settles itself. A delivery is paid at the door and a pickup on collection, both
 * after placement, by whoever was standing there — so the drawer offers {@link RecordPaymentDialog}
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
 * Choose whose evening this is.
 *
 * ## Why a dialog rather than a step in the drawer
 *
 * The drawer is a *reading* surface — the order, its money, its run — and it stays open behind this.
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
 * - **with a version** — a lost race. Somebody else took the run in the seconds since this drawer
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
                <Stack space="xs" testID="kitchen-order-desk-assign-list">
                    {filtered.map((driver) => (
                        // The card is inert and the button is the control — a pressable card
                        // wrapping a button is nested-interactive, which axe reports as serious.
                        // The same shape the sale wizard's customer picker uses, for the same
                        // reason: choosing is not assigning. The confirmation is the footer
                        // button, because a list of a hundred one-tap assignments would be one
                        // mis-tap away from sending tonight's run to the wrong person.
                        <Card
                            key={driver.userId}
                            padding="sm"
                            testID={`kitchen-order-desk-assign-driver-${driver.userId}`}
                        >
                            <Inline space="sm" align="center" wrap justify="between">
                                <Text
                                    variant="bodyStrong"
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
                                        variant="secondary"
                                        label={t('kitchen:desk.assign.choose')}
                                        onPress={() => {
                                            setChosen(driver.userId);
                                        }}
                                    />
                                )}
                            </Inline>
                        </Card>
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
                </Stack>
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

/** One labelled fact in the drawer. Never a table: these are pairs, not a dataset. */
function DetailRow({
    testID,
    label,
    value,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
}) {
    return (
        <Inline space="sm" align="start" justify="between" wrap>
            <Text tone="secondary" variant="caption">
                {label}
            </Text>
            <Text testID={testID}>{value}</Text>
        </Inline>
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
     * The row the drawer was opened from, held rather than looked up by identifier.
     *
     * Fulfilling an order takes it out of the open queue, so a `rows.find(…)` alone would empty the
     * drawer at the moment of success. This is the last known copy; {@link selectedRow} prefers the
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
     * every render, and the drawer would re-derive its row on every tick of the due clock.
     */
    const rows = useMemo<readonly OrderDeskQueueRow[]>(() => queue.data?.rows ?? [], [queue.data]);
    const meta = queue.data?.meta ?? null;
    const failure = toFailure(queue.error);
    const filtered =
        trimmed !== '' || statuses.length > 0 || fulfilmentType !== null || deskWindow !== 'today';

    /**
     * The open row as the queue currently has it, or the copy the drawer was opened with.
     *
     * The fresh one while the order is still open — so a poll that lands a driver on the job updates
     * the drawer under the agent's eyes — and the stale one once the order leaves the queue, which
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
     * because the decision is made; the drawer stays open on the order, which is what the person was
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
     * because the decision is made; the drawer stays open on the order, which is what the person
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

    const columns: readonly TableColumn<OrderDeskQueueRow>[] = [
        {
            key: 'number',
            header: t('kitchen:desk.columnNumber'),
            rowHeader: true,
            flex: 2,
            render: (row) => (
                <Text variant="bodyStrong" testID={`${orderDeskRowTestId(String(row.id))}-number`}>
                    {row.orderNumber}
                </Text>
            ),
        },
        {
            key: 'customer',
            header: t('kitchen:desk.columnCustomer'),
            flex: 2,
            render: (row) => {
                // Absent block and null name are one cell here on purpose — see the file header.
                const name = row.customer?.displayName ?? null;
                const phone = row.customer?.phone ?? null;
                return (
                    <Stack space="none">
                        <Text
                            testID={`${orderDeskRowTestId(String(row.id))}-customer`}
                            {...(name === null
                                ? { accessibilityLabel: t('kitchen:desk.a11y.noCustomerName') }
                                : {})}
                        >
                            {name ?? EM_DASH}
                        </Text>
                        {phone === null ? null : (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID={`${orderDeskRowTestId(String(row.id))}-customer-phone`}
                            >
                                {phone}
                            </Text>
                        )}
                    </Stack>
                );
            },
        },
        {
            key: 'due',
            header: t('kitchen:desk.columnDue'),
            flex: 2,
            render: (row) => (
                <Stack space="none">
                    <Text testID={`${orderDeskRowTestId(String(row.id))}-due`}>
                        {formatter.formatDate(row.dueAt, { timeStyle: 'short' })}
                    </Text>
                    <Badge
                        testID={`${orderDeskRowTestId(String(row.id))}-due-age`}
                        tone={orderDeskDueTone(row.dueAt, now)}
                        label={formatter.formatRelativeTime(row.dueAt, now)}
                    />
                </Stack>
            ),
        },
        {
            key: 'slot',
            header: t('kitchen:desk.columnSlot'),
            render: (row) => (
                <Text tone="secondary" testID={`${orderDeskRowTestId(String(row.id))}-slot`}>
                    {row.delivery.windowCode === null
                        ? t('kitchen:desk.noSlot')
                        : humaniseCode(row.delivery.windowCode)}
                </Text>
            ),
        },
        {
            key: 'status',
            header: t('kitchen:desk.columnStatus'),
            render: (row) => (
                <Badge
                    testID={`${orderDeskRowTestId(String(row.id))}-status`}
                    tone={kitchenOrderStatusTone(row.status)}
                    label={t(kitchenOrderStatusKey(row.status))}
                />
            ),
        },
        {
            key: 'delivery',
            header: t('kitchen:desk.columnDelivery'),
            flex: 2,
            render: (row) => {
                const state = orderDeskDeliveryState(row);
                const testID = `${orderDeskRowTestId(String(row.id))}-delivery`;

                // A pickup or a counter sale is never driven anywhere, so the cell has nothing to
                // say — the same em dash every other "nothing here" cell in this workspace uses,
                // rather than a badge announcing the absence of a thing that was never coming.
                if (state === 'not_delivered') {
                    return (
                        <Text
                            tone="secondary"
                            testID={testID}
                            accessibilityLabel={t(
                                'kitchen:desk.a11y.noDeliveryRun',
                                // The type is what makes the dash meaningful to somebody who cannot
                                // see the column beside it.
                                { type: t(kitchenOrderFulfilmentTypeKey(row.fulfilmentType)) },
                            )}
                        >
                            {EM_DASH}
                        </Text>
                    );
                }

                return (
                    <Stack space="none" testID={testID}>
                        <Badge
                            testID={`${testID}-state`}
                            tone={orderDeskDeliveryStateTone(state)}
                            label={t(orderDeskDeliveryStateKey(state))}
                        />
                        {/*
                         * The tracking axis, and only when there is a run to have one. It is what
                         * the *customer* has been told, which is a different fact from the dispatch
                         * state above it and the one an agent quotes on the telephone.
                         */}
                        {row.deliveryJob === null ? null : (
                            <Text variant="caption" tone="secondary" testID={`${testID}-tracking`}>
                                {t(deliveryJobTrackingKey(row.deliveryJob.trackingStatus))}
                            </Text>
                        )}
                    </Stack>
                );
            },
        },
        {
            key: 'payment',
            header: t('kitchen:desk.columnPayment'),
            flex: 2,
            render: (row) => {
                const testID = `${orderDeskRowTestId(String(row.id))}-payment`;
                return (
                    <Stack space="none" testID={testID}>
                        {/*
                         * The order's *intended* method, which is what an agent asks the customer
                         * for — read before any money arrives, so it is the leading line.
                         */}
                        <Text testID={`${testID}-method`}>
                            {t(kitchenOrderPaymentMethodKey(row.payment.method))}
                        </Text>
                        {/*
                         * "Receipted", never "paid". The platform holds no proof that money exists,
                         * only that somebody wrote down that it arrived — and the outstanding case
                         * shows the *shortfall* rather than a bare "no", because part-payments are
                         * ordinary and the number is what the agent has to collect.
                         */}
                        {row.payment.receipted ? (
                            <Badge
                                testID={`${testID}-state`}
                                tone="success"
                                label={t('kitchen:desk.payment.receipted')}
                            />
                        ) : (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID={`${testID}-outstanding`}
                            >
                                {t('kitchen:desk.payment.outstanding', {
                                    amount: formatMoney(formatter, {
                                        amount: row.totalMinor - row.payment.receivedMinor,
                                        currency: row.currencyCode,
                                    }),
                                })}
                            </Text>
                        )}
                    </Stack>
                );
            },
        },
        {
            key: 'total',
            header: t('kitchen:desk.columnTotal'),
            numeric: true,
            render: (row) => (
                <Text variant="bodyStrong" testID={`${orderDeskRowTestId(String(row.id))}-total`}>
                    {formatMoney(formatter, { amount: row.totalMinor, currency: row.currencyCode })}
                </Text>
            ),
        },
    ];

    const lineColumns: readonly TableColumn<KitchenOrderLine>[] = [
        {
            key: 'name',
            header: t('kitchen:ops.orders.linesHeading'),
            rowHeader: true,
            flex: 2,
            render: (line) => (
                <Stack space="none">
                    <Text variant="bodyStrong">{line.nameEn}</Text>
                    {line.variantLabel === null ? null : (
                        <Text variant="caption" tone="secondary">
                            {line.variantLabel}
                        </Text>
                    )}
                </Stack>
            ),
        },
        {
            key: 'quantity',
            header: t('kitchen:ops.orders.lineQuantity'),
            numeric: true,
            render: (line) => <Text>{formatter.formatNumber(Number(line.quantity))}</Text>,
        },
        {
            key: 'lineTotal',
            header: t('kitchen:ops.orders.lineTotal'),
            numeric: true,
            render: (line) => (
                <Text>
                    {formatMoney(formatter, {
                        amount: line.lineTotalMinor,
                        currency: line.currencyCode,
                    })}
                </Text>
            ),
        },
    ];

    return (
        <Stack space="lg" testID="kitchen-order-desk-screen">
            <Stack space="xs">
                <Heading level={1} testID="kitchen-order-desk-title">
                    {t('kitchen:desk.title')}
                </Heading>
                <Text tone="secondary" testID="kitchen-order-desk-subtitle">
                    {t('kitchen:desk.subtitle')}
                </Text>
                {meta === null ? null : (
                    // The day and the clock the server sorted against. Echoed by the endpoint
                    // because the screen did not choose them and cannot derive them — and with no
                    // branch named, the boundary is UTC rather than this kitchen's local midnight.
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID="kitchen-order-desk-measured-on"
                    >
                        {t('kitchen:desk.measuredOn', {
                            date: formatter.formatDate(meta.today, { dateStyle: 'medium' }),
                            timezone: meta.timezone,
                        })}
                    </Text>
                )}
            </Stack>

            <Card tone="raised" padding="md" testID="kitchen-order-desk-toolbar">
                <Stack space="sm">
                    {/*
                     * The queue's primary action, and its first: this screen had none, because
                     * until the desk could sell there was nothing for one to do. It sits at the top
                     * of the toolbar rather than beside the filters — starting a sale is not a way
                     * of narrowing the queue, and a customer at the counter is not waiting for
                     * somebody to scroll.
                     *
                     * A `Link`-wrapped `Button` is not the house pattern here; the router push is,
                     * because the surrounding surfaces navigate that way and a nested anchor around
                     * a button is the nested-interactive trap the basket is built to avoid.
                     */}
                    <Inline space="sm" wrap testID="kitchen-order-desk-actions">
                        <Button
                            testID="kitchen-order-desk-new-sale"
                            label={t('kitchen:desk.newSale')}
                            onPress={() => {
                                router.push('/kitchen/order-desk/sale');
                            }}
                        />
                    </Inline>

                    <SegmentedControl<OrderDeskWindow>
                        testID="kitchen-order-desk-window"
                        label={t('kitchen:desk.windowLabel')}
                        block
                        value={deskWindow}
                        onChange={setDeskWindow}
                        items={ORDER_DESK_WINDOWS.map((candidate) => ({
                            value: candidate,
                            label: t(WINDOW_LABEL_KEYS[candidate]),
                            testID: `kitchen-order-desk-window-${candidate}`,
                        }))}
                    />

                    {/*
                     * One kind of sale, or all three — a single-choice control because the endpoint
                     * takes a single value. The three types are three different jobs done by three
                     * different people (a dispatch board wants deliveries, a collection counter
                     * wants pickups), which is why this is not the chip row the statuses use: nobody
                     * asks for "deliveries and counter sales but not pickups".
                     *
                     * The "all kinds" option is this screen's, not the wire's. Choosing it omits the
                     * parameter, which is what the server reads as no narrowing at all.
                     */}
                    <Select<OrderDeskFulfilmentType | typeof ANY_FULFILMENT_TYPE>
                        testID="kitchen-order-desk-type"
                        id="kitchen-order-desk-type"
                        label={t('kitchen:desk.filterTypeLabel')}
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

                    <TextInputField
                        testID="kitchen-order-desk-search"
                        id="kitchen-order-desk-search"
                        label={t('kitchen:desk.searchLabel')}
                        placeholder={t('kitchen:desk.searchPlaceholder')}
                        hint={t('kitchen:desk.searchHint')}
                        value={query}
                        onChangeText={setQuery}
                        autoCapitalize="none"
                        autoCorrect={false}
                        inputMode="search"
                        returnKeyType="search"
                        trailing={<Icon name="search" />}
                    />

                    <Stack space="xs">
                        <Text variant="label" testID="kitchen-order-desk-status-label">
                            {t('kitchen:desk.statusLabel')}
                        </Text>
                        {/*
                         * Chips rather than a segmented control: the two open statuses are a
                         * *subset* filter — a desk agent watching for unconfirmed work wants
                         * `placed` alone, and neither selected means both, which a single-choice
                         * control cannot say without inventing an "All" value the wire does not
                         * have.
                         */}
                        <Inline space="xs" wrap testID="kitchen-order-desk-status">
                            {ORDER_DESK_QUEUE_STATUSES.map((candidate) => (
                                <FilterChip
                                    key={candidate}
                                    testID={`kitchen-order-desk-status-${candidate}`}
                                    label={t(kitchenOrderStatusKey(candidate))}
                                    selected={statuses.includes(candidate)}
                                    onChange={(selected) => {
                                        toggleStatus(candidate, selected);
                                    }}
                                />
                            ))}
                        </Inline>
                    </Stack>

                    {meta === null ? null : (
                        <Text
                            testID="kitchen-order-desk-result-summary"
                            role="status"
                            aria-live="polite"
                            variant="label"
                        >
                            {t('kitchen:toolbar.resultCount', { count: meta.count })}
                        </Text>
                    )}
                </Stack>
            </Card>

            {queue.isPending ? (
                <Stack space="sm" testID="kitchen-order-desk-loading">
                    {Array.from({ length: 5 }, (_, index) => (
                        <Card key={index} padding="md">
                            <Stack space="xs">
                                <Skeleton
                                    testID={`kitchen-order-desk-skeleton-${String(index + 1)}`}
                                    heightClassName="h-5"
                                />
                                <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                            </Stack>
                        </Card>
                    ))}
                </Stack>
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
                        filtered ? (
                            <Button
                                testID="kitchen-order-desk-clear"
                                variant="secondary"
                                label={t('kitchen:desk.clearFilters')}
                                onPress={clearFilters}
                            />
                        ) : undefined
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

                    <Table<OrderDeskQueueRow>
                        testID="kitchen-order-desk-table"
                        caption={t('kitchen:desk.caption')}
                        captionHidden
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => String(row.id)}
                        rowAction={{
                            header: t('kitchen:desk.columnActions'),
                            render: (row) => (
                                <Button
                                    testID={`${orderDeskRowTestId(String(row.id))}-open`}
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:desk.open')}
                                    onPress={() => {
                                        openDetail(row);
                                    }}
                                />
                            ),
                        }}
                    />
                </Stack>
            )}

            <Drawer
                testID="kitchen-order-desk-detail"
                placement="end"
                open={selected !== null}
                onClose={closeDetail}
                title={
                    selectedRow === null
                        ? t('kitchen:desk.title')
                        : t('kitchen:ops.orders.detailTitle', { number: selectedRow.orderNumber })
                }
                className="w-[520px]"
                footer={
                    order === null || !canManage ? undefined : (
                        <Inline space="sm" wrap justify="end" align="center">
                            {/*
                             * The driver's own axis, beside the button that closes the order rather
                             * than instead of it. The desk is not blocked on a delivery stamp — see
                             * the file header — so this is what makes the close an informed one.
                             */}
                            {selectedRow?.deliveryJob == null ||
                            !canFulfilKitchenOrder(order.status) ? null : (
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    testID="kitchen-order-desk-detail-fulfil-tracking"
                                >
                                    {t(
                                        deliveryJobTrackingKey(
                                            selectedRow.deliveryJob.trackingStatus,
                                        ),
                                    )}
                                </Text>
                            )}
                            {canConfirmKitchenOrder(order.status) ? (
                                <Button
                                    testID="kitchen-order-desk-detail-confirm"
                                    label={t('kitchen:ops.orders.confirm')}
                                    loading={confirmOrder.isPending}
                                    disabled={actionPending}
                                    onPress={() => {
                                        transition('confirm');
                                    }}
                                />
                            ) : null}
                            {canFulfilKitchenOrder(order.status) ? (
                                <Button
                                    testID="kitchen-order-desk-detail-fulfil"
                                    label={t('kitchen:ops.orders.fulfil')}
                                    loading={fulfilOrder.isPending}
                                    disabled={actionPending}
                                    onPress={() => {
                                        transition('fulfil');
                                    }}
                                />
                            ) : null}
                        </Inline>
                    )
                }
            >
                {detail.isPending ? (
                    <Skeleton testID="kitchen-order-desk-detail-loading" heightClassName="h-40" />
                ) : detailFailure !== null ? (
                    <ErrorState
                        testID="kitchen-order-desk-detail-error"
                        title={t('kitchen:ops.orders.detailLoadErrorTitle')}
                        failure={detailFailure}
                        onRetry={() => {
                            void detail.refetch();
                        }}
                        retrying={detail.isFetching}
                    />
                ) : order === null ? null : (
                    <Stack space="lg" testID="kitchen-order-desk-detail-body">
                        <Inline space="sm" align="center" wrap>
                            <Badge
                                testID="kitchen-order-desk-detail-status"
                                tone={kitchenOrderStatusTone(order.status)}
                                label={t(kitchenOrderStatusKey(order.status))}
                            />
                            <Badge
                                testID="kitchen-order-desk-detail-type"
                                tone="neutral"
                                icon={null}
                                label={t(kitchenOrderFulfilmentTypeKey(order.fulfilmentType))}
                            />
                        </Inline>

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
                            <Text testID="kitchen-order-desk-detail-action-error" tone="danger">
                                {actionFailure.message}
                            </Text>
                        )}

                        <Stack space="xs" testID="kitchen-order-desk-detail-payment">
                            <Heading level={3}>{t('kitchen:desk.paymentHeading')}</Heading>
                            <DetailRow
                                testID="kitchen-order-desk-detail-payment-method"
                                label={t('kitchen:desk.paymentMethod')}
                                value={t(
                                    kitchenOrderPaymentMethodKey(
                                        selectedRow?.payment.method ?? order.paymentMethod,
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
                                    <DetailRow
                                        testID="kitchen-order-desk-detail-payment-received"
                                        label={t('kitchen:desk.paymentReceived')}
                                        value={formatMoney(formatter, {
                                            amount: selectedRow.payment.receivedMinor,
                                            currency: selectedRow.currencyCode,
                                        })}
                                    />
                                    <DetailRow
                                        testID="kitchen-order-desk-detail-payment-state"
                                        label={t('kitchen:desk.paymentState')}
                                        value={t(
                                            selectedRow.payment.receipted
                                                ? 'kitchen:desk.payment.receipted'
                                                : 'kitchen:desk.payment.notReceipted',
                                        )}
                                    />
                                    {/*
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
                                     * A counter sale never reaches this drawer: it arrives already
                                     * fulfilled and settled, so it is not in the open queue at all.
                                     */}
                                    {selectedRow.payment.receipted ||
                                    order.status === 'cancelled' ||
                                    !canManage ? null : (
                                        <Inline space="sm" wrap>
                                            <Button
                                                testID="kitchen-order-desk-detail-record-payment"
                                                size="sm"
                                                variant="secondary"
                                                label={t('kitchen:desk.recordPayment.open')}
                                                onPress={() => {
                                                    setRecordingPayment(true);
                                                }}
                                            />
                                        </Inline>
                                    )}
                                </>
                            )}
                        </Stack>

                        {/*
                         * The run, and only for an order that has one to have. A pickup showing an
                         * empty "Delivery" section would be a heading about nothing.
                         */}
                        {selectedRow === null ||
                        orderDeskDeliveryState(selectedRow) === 'not_delivered' ? null : (
                            <Stack space="xs" testID="kitchen-order-desk-detail-delivery">
                                <Heading level={3}>{t('kitchen:desk.deliveryHeading')}</Heading>
                                <DetailRow
                                    testID="kitchen-order-desk-detail-delivery-state"
                                    label={t('kitchen:desk.deliveryState')}
                                    value={t(
                                        orderDeskDeliveryStateKey(
                                            orderDeskDeliveryState(selectedRow),
                                        ),
                                    )}
                                />
                                {selectedRow.deliveryJob === null ? null : (
                                    <>
                                        <DetailRow
                                            testID="kitchen-order-desk-detail-delivery-status"
                                            label={t('kitchen:desk.deliveryStatus')}
                                            value={t(
                                                deliveryJobStatusKey(
                                                    selectedRow.deliveryJob.status,
                                                ),
                                            )}
                                        />
                                        <DetailRow
                                            testID="kitchen-order-desk-detail-delivery-tracking"
                                            label={t('kitchen:desk.deliveryTracking')}
                                            value={t(
                                                deliveryJobTrackingKey(
                                                    selectedRow.deliveryJob.trackingStatus,
                                                ),
                                            )}
                                        />
                                        <DetailRow
                                            testID="kitchen-order-desk-detail-delivery-assigned-at"
                                            label={t('kitchen:desk.deliveryAssignedAt')}
                                            // Null on a run nobody has taken — which the state row
                                            // above has already said in words.
                                            value={
                                                selectedRow.deliveryJob.assignedAt === null
                                                    ? t('kitchen:common.notRecorded')
                                                    : formatter.formatDate(
                                                          selectedRow.deliveryJob.assignedAt,
                                                      )
                                            }
                                        />
                                    </>
                                )}
                                {/*
                                 * The control that spent a slice not existing. `canManage` gates
                                 * it on the same code the lifecycle buttons take: choosing whose
                                 * evening this is, is managing the order rather than reading it.
                                 */}
                                {selectedRow.deliveryJob === null ||
                                !canManage ||
                                !canAssignDeliveryJob(selectedRow.deliveryJob.status) ? null : (
                                    <Inline space="sm" wrap>
                                        <Button
                                            testID="kitchen-order-desk-detail-assign"
                                            size="sm"
                                            variant="secondary"
                                            label={t(
                                                selectedRow.deliveryJob.driverUserId === null
                                                    ? 'kitchen:desk.assign.open'
                                                    : 'kitchen:desk.assign.reopen',
                                            )}
                                            onPress={() => {
                                                openAssign();
                                            }}
                                        />
                                    </Inline>
                                )}
                            </Stack>
                        )}

                        <Stack space="sm">
                            <Heading level={3} testID="kitchen-order-desk-detail-lines-heading">
                                {t('kitchen:ops.orders.linesHeading')}
                            </Heading>
                            {/*
                             * No `rowAction` and no pressable rows: every control in this drawer is
                             * in the footer, so nothing here can nest one interactive element
                             * inside another.
                             */}
                            <Table<KitchenOrderLine>
                                testID="kitchen-order-desk-detail-lines"
                                caption={t('kitchen:ops.orders.linesHeading')}
                                captionHidden
                                columns={lineColumns}
                                rows={order.lines}
                                rowKey={(line) => line.id}
                            />
                        </Stack>

                        <Stack space="xs" testID="kitchen-order-desk-detail-totals">
                            <Heading level={3}>{t('kitchen:ops.orders.totalsHeading')}</Heading>
                            <DetailRow
                                testID="kitchen-order-desk-detail-subtotal"
                                label={t('kitchen:ops.orders.subtotal')}
                                value={formatMoney(formatter, {
                                    amount: order.subtotalMinor,
                                    currency: order.currencyCode,
                                })}
                            />
                            <DetailRow
                                testID="kitchen-order-desk-detail-delivery-fee"
                                label={t('kitchen:ops.orders.deliveryFee')}
                                // `null` is not zero: a free delivery and a collection that never
                                // had a fee are different facts.
                                value={
                                    order.deliveryFeeMinor === null
                                        ? t('kitchen:ops.orders.noDeliveryFee')
                                        : formatMoney(formatter, {
                                              amount: order.deliveryFeeMinor,
                                              currency: order.currencyCode,
                                          })
                                }
                            />
                            <DetailRow
                                testID="kitchen-order-desk-detail-total"
                                label={t('kitchen:ops.orders.total')}
                                value={formatMoney(formatter, {
                                    amount: order.totalMinor,
                                    currency: order.currencyCode,
                                })}
                            />
                        </Stack>
                    </Stack>
                )}
            </Drawer>

            {/*
             * Outside the drawer rather than inside it: the drawer's body scrolls, and a modal
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
             * Outside the drawer for the assign dialog's reason — a modal mounted inside a scrolling
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
        </Stack>
    );
}
