import type {
    KitchenOrder,
    KitchenOrderPaymentMethod,
    LocalisedText,
    OrderDeskDeliveryWindow,
    OrderDeskDriver,
    OrderDeskFulfilmentType,
    OrderDeskQuote,
    OrderDeskQuoteLine,
    OrderDeskSaleRequest,
} from '@healthy360/api-client/contracts';
import { ORDER_DESK_FULFILMENT_TYPES } from '@healthy360/api-client/contracts';
import { OrderId } from '@healthy360/domain-types';
import {
    Badge,
    Button,
    Callout,
    DatePickerButton,
    EmptyState,
    ErrorState,
    FormSection,
    Icon,
    IconButton,
    Select,
    Skeleton,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { fieldWidth } from '@healthy360/design-tokens';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    KITCHEN_PAGE_SIZE,
    pagesInResultOf,
    useAdminMealPageQuery,
    useProductPageQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { useKitchenOrderQuery } from '../../../data/kitchen-orders-hooks.ts';
import {
    useAmendOrderDeskOrderMutation,
    useOrderDeskDeliveryWindowsQuery,
    useOrderDeskDriversQuery,
    useOrderDeskQuoteQuery,
    usePlaceOrderDeskSaleMutation,
} from '../../../data/order-desk-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { todayIso } from '../../commerce/dates.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { useCataloguePort } from '../catalogue/catalogue-nav.tsx';
import { CataloguePager } from '../catalogue/catalogue-pager.tsx';
import { CatalogueToolbar } from '../catalogue/catalogue-toolbar.tsx';
import { ORDER_CREATE_ON_BEHALF_PERMISSION, ORDER_MANAGE_PERMISSION } from '../entity-registry.ts';
import { displayName } from '../format.ts';
import { ChoiceTiles } from '../choice-tiles.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { EditorGuardDialogs } from '../record-form-opening.tsx';
import { useUnsavedGuardFor } from '../use-unsaved-guard.ts';
import { kitchenOrderPaymentMethodKey } from '../ops-format.ts';
import type { BasketLine } from '../order-desk/basket.ts';
import {
    MAX_LINE_QUANTITY,
    addItem,
    isQuotableBasket,
    basketKey,
    lineKey,
    quantityAsNumber,
    quantityFromNumber,
    setQuantity,
    toWire,
} from '../order-desk/basket.ts';
import { AddressSection, CustomerSection } from '../order-desk/sale-customer.tsx';
import type { SaleShortfall, SaleState } from '../order-desk/sale-state.ts';
import {
    initialSaleState,
    needsAddress,
    needsCustomer,
    paymentMethodsFor,
    saleShortfall,
    saleStateFromOrder,
    firstOpenDay,
    offeredDeskWindows,
    windowsOverAt,
    scheduleFor,
    withCustomer,
    withFulfilmentType,
    withPaymentMethod,
} from '../order-desk/sale-state.ts';
import { useDebouncedValue } from '../order-desk/use-debounced-value.ts';

/**
 * `/kitchen/order-desk/sale` — ringing up a counter, collection or telephone sale. Kitchen v2 `4f`.
 *
 * ## One page
 *
 * This used to be a six-step wizard, and for a while a separate counter screen stood beside it. It
 * is one page now, laid out the way `4f` draws the till: the menu as a grid of products, tapped onto
 * a ticket that runs beside it.
 *
 * The page has two stages, and the ticket stays beside both. In the **menu** stage the agent picks
 * the food and the ticket's one button is Charge. Charge opens the **checkout** stage in the
 * menu's column: a Back button, then how the order leaves — counter, collection or delivery, three
 * cards with none chosen yet. A counter sale needs nothing else; a **collection** opens a Customer
 * card and a **delivery** a Customer card and an Address card, each folding to one line once it is
 * answered. Only once the kind is chosen does the ticket offer the payment methods and the button
 * that places the sale, and it says what is still missing — `saleShortfall` in
 * `order-desk/sale-state.ts`, which also owns what choosing the kind clears. The stage is this
 * screen's own state, not the sale's: emptying the ticket goes back to the menu.
 *
 * It sits on the admin's compact ladder, the Ingredients screen's sizes: the search and the menu's
 * sections are that screen's `CatalogueToolbar`, and the cards are the record editors'
 * `FormSection variant="card"`, whose title is a step above everything under it. Inside a tile the
 * product's name is the title — `strong` over its `mono` price.
 *
 * ## Every price comes from the quote endpoint, and none of them is computed here
 *
 * The desk's tariff is resolved server-side through the desk channel's own price lists, and there is
 * no client-reachable read of that resolution — no endpoint lists a channel's offerings with prices.
 * So the page asks the one oracle there is, twice:
 *
 * - **The ticket** is quoted on every change, debounced, with the customer and the destination,
 *   because all three change the answer. Its totals are the quote's own fields; nothing multiplies a
 *   unit price by a quantity locally — the wire rounds once at the line total, and a client that
 *   re-derived it would eventually disagree with the sale it had just quoted.
 * - **The menu section on screen** is quoted as a counter basket of one of each, once per section
 *   and search (and per customer, whose price lists can differ), and each tile shows its line's unit
 *   price. A line the desk channel refuses comes back with a refusal, and its tile says so and cannot
 *   be tapped, rather than accepting a tap the ticket would then refuse.
 *
 * Refusals arrive on a `200` as **data**. Placing is gated on a *fresh* `quote.quotable`, the server's
 * own verdict, as well as on the shortfall — an agent cannot place a ticket whose price is in flight
 * and then read out a number that changes under them.
 *
 * The page has no issue tray (taken off it on 2026-10-28, at the user's request). A total that could
 * not be worked out is said under the ticket's "—"; the customer and address cards' warnings — a
 * shared number, an area nobody delivers to — are strips at the head of those cards
 * (`order-desk/sale-customer.tsx`). A refused sale or edit stays on the ticket, beside the button
 * that was pressed, with the edit's own reasons and its conflict.
 *
 * ## What the design draws that this does not
 *
 * - **VAT.** The quote carries a subtotal, an optional fee and a total — no tax line. A tax figure
 *   worked out here would be the one number on the ticket the server never agreed to.
 * - **A ticket number.** The order number exists once the order does.
 * - **+ Customer on a counter sale.** Counter sales are anonymous in v1; `sale-state.ts` says why.
 * - **Packs.** The wire addresses a pack by `catalogue_item_variant_id`, and the catalogue listing
 *   exposes pack variants by `code` with no identifier — so the menu sells the plain article, and the
 *   basket keys on `(article, pack)` anyway so that packs land as a menu change rather than a rewrite.
 *
 * **A dedicated `order_desk_agent` does not hold `catalogue.view_organisation`**, so the menu's read
 * is a `403` for exactly the role this screen is named after. It renders as a failure with its own
 * retry rather than as an empty menu; the fix is a grant or a desk-scoped catalogue read.
 *
 * ## The a11y rule the ticket is built around
 *
 * A ticket line holds two stepper buttons, so the line takes no press — nested interactive content
 * is a serious axe violation. A product tile is the opposite case: it *is* its control and holds
 * nothing else, and the count drawn on it is in its label rather than a second thing to reach.
 */

/** Re-ask for a price this long after the ticket stops changing: every change is a `POST`. */
const QUOTE_DEBOUNCE_MS = 300;

/** The same wait for the menu search. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The narrowest the ticket may be beside the menu. A style: there is no rail-width token. Wide
 * enough for a name beside a stepper pair and a line total at the compact sizes. It is a floor, not
 * the ticket's width: beside the menu the ticket takes whatever the tiles leave.
 */
const TICKET_MIN_WIDTH = 320;

/**
 * A product tile's width beside the ticket. Fixed, so the menu column is exactly as wide as the
 * tiles in it and the toolbar above them ends where the last tile does.
 */
const TILE_WIDTH = 192;

/**
 * The narrowest a product tile may be before the grid drops a column, when the menu runs the full
 * width above the ticket. Below this the name no longer fits two lines.
 */
const TILE_MIN_WIDTH = 150;

/** The gap between tiles — `gap-snug`, repeated as a number because the tile width is computed. */
const TILE_GAP = 12;

/**
 * The ticket line's quantity and total slots. Fixed, so every line's stepper sits in the same
 * column whether its total is $3.00 or $1,000.00 — the figures are `tabular-nums`, but a longer
 * figure still pushed the stepper over. Widths, not tokens, for the same reason as the tile's:
 * the quantity fits `MAX_LINE_QUANTITY`'s three digits, the total a four-figure amount with its
 * currency.
 */
const LINE_QUANTITY_WIDTH = 28;
const LINE_TOTAL_WIDTH = 88;

/**
 * What the sticky ticket spends on everything but its lines — the top bar and content padding above
 * it, the card's title, the totals, the payment choice and Charge. An estimate on the generous side:
 * guessing short would push Charge back under the fold, guessing long only scrolls the lines sooner.
 */
const TICKET_CHROME_HEIGHT = 420;

/** The lines' floor, about three of them, however short the window. */
const TICKET_LINES_MIN_HEIGHT = 168;

/** The gap between the menu and the ticket — `gap-base`, repeated for the same reason. */
const BODY_GAP = 16;

const EM_DASH = '—';

const FULFILMENT_LABEL_KEYS: Readonly<Record<OrderDeskFulfilmentType, string>> = {
    counter: 'kitchen:desk.sale.type.counter',
    pickup: 'kitchen:desk.sale.type.pickup',
    delivery: 'kitchen:desk.sale.type.delivery',
};

/** The page's two stages — see the file header. */
type SaleStage = 'menu' | 'checkout';

/** The column the other stage is in: kept mounted, out of layout and out of the a11y tree. */
const HIDDEN = { display: 'none' } as const;

/**
 * The menu's sections, in the order they are drawn.
 *
 * Each is a real read rather than a pass over one loaded page: meals are one endpoint and the four
 * packaged kinds are the product endpoint's `itemType`, which is how the Catalogue itself files them.
 */
const MENU_SECTIONS = ['meals', 'product', 'sauce', 'dressing', 'frozen_meal'] as const;
type MenuSection = (typeof MENU_SECTIONS)[number];

const SECTION_LABEL_KEYS: Readonly<Record<MenuSection, string>> = {
    meals: 'kitchen:desk.sale.section.meals',
    product: 'kitchen:desk.sale.section.products',
    sauce: 'kitchen:desk.sale.section.sauces',
    dressing: 'kitchen:desk.sale.section.dressings',
    frozen_meal: 'kitchen:desk.sale.section.frozenMeals',
};

const SHORTFALL_KEYS: Readonly<Record<Exclude<SaleShortfall, 'items'>, string>> = {
    customer: 'kitchen:desk.sale.shortfall.customer',
    address: 'kitchen:desk.sale.shortfall.address',
    reference: 'kitchen:desk.sale.shortfall.reference',
};

/** One button on the menu. */
interface MenuTile {
    readonly id: string;
    readonly name: LocalisedText;
    readonly imageId: string;
    /**
     * The record's uploaded photo (BUG-14), else its recipe's — shown in place of `imageId`'s when
     * set, the same order the marketplace card uses.
     */
    readonly photoUrl: string | null | undefined;
}

export function OrderDeskSaleScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_CREATE_ON_BEHALF_PERMISSION] }}
            testID="kitchen-order-desk-sale"
        >
            <Sale />
        </Gate>
    );
}

function Sale() {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();
    const { locale } = useLocale();

    const [state, setState] = useState<SaleState>(initialSaleState);
    /** Picking the food, or — after Charge — saying how it leaves and taking the money. */
    const [stage, setStage] = useState<SaleStage>('menu');
    /**
     * Whether the agent has said how the order leaves. `state.fulfilmentType` is never empty — it
     * stays `counter` underneath, which is the tariff the menu is priced on — so "not chosen yet"
     * is this screen's to remember, and the ticket offers no payment until it is.
     */
    const [kindChosen, setKindChosen] = useState(false);
    const [section, setSection] = useState<MenuSection>('meals');
    const [query, setQuery] = useState('');
    /** The counter sale just rung up, said on the ticket until the next tap starts another. */
    const [sold, setSold] = useState<KitchenOrder | null>(null);
    /*
     * The body row's width, read from the node rather than from `onLayout`: on the web `onLayout`
     * is a `ResizeObserver` that delivered one early width and nothing after it, so the tiles were
     * cut for a narrower row than the one on screen and a band of nothing opened between the last
     * tile and the ticket. The port hook reads on mount, on resize and when the nav rail settles.
     */
    const port = useCataloguePort();
    const bodyWidth = port.width;

    const place = usePlaceOrderDeskSaleMutation();
    const amend = useAmendOrderDeskOrderMutation();

    /*
     * Edit mode: `?order=<id>` opens a placed order on this page instead of a new sale. The order is
     * seeded into the sale once per `id:lockVersion`, and only while the agent has changed nothing —
     * a background re-read must not wipe their edits (`recipe-edit-screen.tsx`'s pattern). The seed
     * is kept: it is what "changed" is measured against, and its `lockVersion` is the one the save
     * sends, whatever a later re-read says.
     */
    const params = useLocalSearchParams<{ order?: string }>();
    const editOrderId =
        typeof params.order === 'string' && params.order !== ''
            ? OrderId.unsafe(params.order)
            : null;
    const editing = useKitchenOrderQuery(editOrderId, editOrderId !== null);
    const editOrder = editOrderId === null ? null : (editing.data ?? null);
    const [seed, setSeed] = useState<{
        readonly key: string;
        readonly lockVersion: number;
        readonly state: SaleState;
    } | null>(null);
    const [editDirty, setEditDirty] = useState(false);
    /** On an edited delivery: whether the agent has opened Change address. */
    const [changingAddress, setChangingAddress] = useState(false);
    const editKey =
        editOrder === null ? null : `${String(editOrder.id)}:${String(editOrder.lockVersion)}`;
    if (editOrder !== null && editKey !== null && editKey !== seed?.key && !editDirty) {
        const seeded = saleStateFromOrder(editOrder);
        setSeed({ key: editKey, lockVersion: editOrder.lockVersion, state: seeded });
        setState(seeded);
        setStage('checkout');
        setKindChosen(true);
        setChangingAddress(false);
    }
    const isEditing = editOrderId !== null;

    /*
     * The day, the slot and the driver, for the sales that need them. The slots are the kitchen's
     * own active windows; the driver list is read only by somebody allowed to assign a run
     * (`order.manage_organisation`), because the placement refuses a driver from anybody else and
     * offering the picker would invite that refusal.
     */
    const checkingOut = stage === 'checkout' && kindChosen;
    const windows = useOrderDeskDeliveryWindowsQuery(
        checkingOut && state.fulfilmentType !== 'counter',
    );
    const canAssign = useCan(ORDER_MANAGE_PERMISSION);
    const drivers = useOrderDeskDriversQuery(
        checkingOut && canAssign && state.fulfilmentType === 'delivery',
    );

    // Naming the leaf is what makes "Order desk" in the trail a link back.
    useKitchenTrailLeaf(
        editOrder === null
            ? t('kitchen:desk.sale.title')
            : t('kitchen:desk.edit.title', { number: editOrder.orderNumber }),
    );

    /*
     * A ticket with something on it, or an order with changes, is work to lose: leaving by the
     * trail, the sidebar or the browser's Back asks first. Placed, there is nothing left to lose.
     */
    const guard = useUnsavedGuardFor(
        sold === null && (isEditing ? editDirty : state.lines.length > 0),
        { message: t('kitchen:unsaved.browserPrompt') },
    );

    function update(next: SaleState) {
        setState(next);
        setSold(null);
        place.reset();
        amend.reset();
        if (isEditing) setEditDirty(true);
        // A checkout with nothing on the ticket has nothing to check out.
        if (next.lines.length === 0) setStage('menu');
    }

    /*
     * What the ticket's quote is asked. `null` while there is nothing to price. Memoised because this
     * object *is* the query key: an equal-but-new object per render would be a request per render.
     */
    const saleRequest = useMemo<OrderDeskSaleRequest | null>(() => {
        const lines = toWire(state.lines);
        if (lines.length === 0) return null;
        return {
            fulfilmentType: state.fulfilmentType,
            lines,
            ...(state.customerAccountId === null
                ? {}
                : { customerAccountId: state.customerAccountId }),
            ...(state.customerAddressId === null
                ? {}
                : { customerAddressId: state.customerAddressId }),
            // An edit is quoted on the order's own channel and on the day and slot the save will
            // keep or send, so the total read out is the total saved.
            ...(editOrderId === null
                ? {}
                : {
                      amendingOrderId: String(editOrderId),
                      ...(state.requestedDeliveryDate === null
                          ? {}
                          : { requestedDeliveryDate: state.requestedDeliveryDate }),
                      ...(state.deliveryWindowCode === null
                          ? {}
                          : { deliveryWindowCode: state.deliveryWindowCode }),
                  }),
        };
    }, [
        state.lines,
        state.fulfilmentType,
        state.customerAccountId,
        state.customerAddressId,
        state.requestedDeliveryDate,
        state.deliveryWindowCode,
        editOrderId,
    ]);

    const quotedRequest = useDebouncedValue(saleRequest, QUOTE_DEBOUNCE_MS);
    const ticketQuote = useOrderDeskQuoteQuery(quotedRequest);
    /*
     * The hook keeps the previous answer so a total does not blank between taps — right while a
     * ticket is changing, wrong the moment it is emptied, where it would leave a price on screen for
     * a sale with no lines. So an absent request drops it here.
     */
    const quote = saleRequest === null ? null : (ticketQuote.data ?? null);
    const quoteStale = quotedRequest !== saleRequest || ticketQuote.isFetching;

    // On a delivery, only the slots the address's zone offers; the default is chosen among those.
    const offeredCodes =
        state.fulfilmentType === 'delivery' ? (quote?.offeredWindowCodes ?? null) : null;
    // An edit always offers the order's stored slot, even one its zone has since dropped.
    const seedWindow = seed?.state.deliveryWindowCode ?? null;
    const windowList = offeredDeskWindows(
        windows.data ?? [],
        offeredCodes === null || seedWindow === null ? offeredCodes : [...offeredCodes, seedWindow],
    );
    const today = todayIso();
    const windowCodes = windowList.map((window) => window.code);
    /*
     * On an edit there is no client-side cut-off: staff may override it, so an ended slot stays
     * choosable and the stored one stays selected. Nor is `scheduleFor` used — it would quietly
     * move a stored slot that has ended — the state's own day and slot are shown as they are.
     */
    const overToday = isEditing ? new Set<string>() : windowsOverAt(windowList);
    const schedule = !isEditing
        ? scheduleFor(state, today, windowCodes, overToday)
        : state.fulfilmentType === 'counter'
          ? null
          : {
                requestedDeliveryDate: state.requestedDeliveryDate ?? today,
                deliveryWindowCode: state.deliveryWindowCode,
            };

    /**
     * Save an edit. The basket is sent whole; the day, the slot and the method only when the agent
     * changed them from the seed, and the address only when one was added — omitted keeps what is
     * stored, so an untouched slot that has since ended is never rewritten.
     */
    function onSave() {
        if (editOrderId === null || seed === null) return;
        const lines = toWire(state.lines);
        if (lines.length === 0) return;
        const was = seed.state;

        amend.mutate(
            {
                id: String(editOrderId),
                lockVersion: seed.lockVersion,
                lines,
                ...(state.customerAddressId === null
                    ? {}
                    : { customerAddressId: state.customerAddressId }),
                ...(state.requestedDeliveryDate === null ||
                state.requestedDeliveryDate === was.requestedDeliveryDate
                    ? {}
                    : { requestedDeliveryDate: state.requestedDeliveryDate }),
                ...(state.deliveryWindowCode === null ||
                state.deliveryWindowCode === was.deliveryWindowCode
                    ? {}
                    : { deliveryWindowCode: state.deliveryWindowCode }),
                ...(state.paymentMethod === was.paymentMethod
                    ? {}
                    : { paymentMethod: state.paymentMethod }),
            },
            {
                onSuccess: (order) => {
                    toast.show({
                        testID: 'kitchen-order-desk-sale-saved-toast',
                        tone: 'success',
                        message: t('kitchen:desk.edit.savedToast', { number: order.orderNumber }),
                    });
                    router.replace('/kitchen/order-desk');
                },
            },
        );
    }

    /** After a `409 resource.conflict`: drop the edits and seed again from a fresh read. */
    function onReload() {
        amend.reset();
        setEditDirty(false);
        setSeed(null);
        void editing.refetch();
    }

    function onPlace() {
        const lines = toWire(state.lines);
        if (lines.length === 0) return;
        const counter = state.fulfilmentType === 'counter';

        place.mutate(
            {
                fulfilmentType: state.fulfilmentType,
                lines,
                paymentMethod: state.paymentMethod,
                ...(state.customerAccountId === null
                    ? {}
                    : { customerAccountId: state.customerAccountId }),
                ...(state.customerAddressId === null
                    ? {}
                    : { customerAddressId: state.customerAddressId }),
                ...(schedule === null
                    ? {}
                    : {
                          requestedDeliveryDate: schedule.requestedDeliveryDate,
                          ...(schedule.deliveryWindowCode === null
                              ? {}
                              : { deliveryWindowCode: schedule.deliveryWindowCode }),
                      }),
                ...(state.driverUserId === null ? {} : { driverUserId: state.driverUserId }),
                ...(counter && state.payment !== null
                    ? {
                          payment: {
                              method: state.payment.method,
                              ...(state.payment.reference.trim() === ''
                                  ? {}
                                  : { reference: state.payment.reference.trim() }),
                          },
                      }
                    : {}),
            },
            {
                onSuccess: (order) => {
                    if (counter) {
                        // Place → confirm → receipt → fulfil ran in one transaction: the sale is
                        // done and the next customer is already waiting, so the ticket clears and
                        // the page stays where it is.
                        setState(initialSaleState());
                        setStage('menu');
                        setKindChosen(false);
                        setSold(order);
                        toast.show({
                            testID: 'kitchen-order-desk-sale-sold-toast',
                            tone: 'success',
                            message: t('kitchen:desk.sale.soldToast', {
                                number: order.orderNumber,
                            }),
                        });
                        return;
                    }
                    // A delivery comes back confirmed: its run already exists, assigned when a
                    // driver was named and waiting in the drivers' pool when not.
                    const toastKey =
                        state.fulfilmentType !== 'delivery'
                            ? 'kitchen:desk.sale.placedToast'
                            : state.driverUserId === null
                              ? 'kitchen:desk.sale.placedConfirmedToast'
                              : 'kitchen:desk.sale.placedAssignedToast';
                    toast.show({
                        testID: 'kitchen-order-desk-sale-placed-toast',
                        tone: 'success',
                        message: t(toastKey, { number: order.orderNumber }),
                    });
                    router.replace('/kitchen/order-desk');
                },
            },
        );
    }

    /*
     * Beside or under. The ticket sits beside the menu wherever two tiles still fit next to it, and
     * under it on anything narrower, where a fixed column would leave the menu one tile wide.
     *
     * Beside it, the menu takes as many whole tiles as fit and not a pixel more — so the toolbar
     * above them is the tiles' width — and the ticket takes the rest. A menu that filled the row
     * instead left the remainder after its last whole tile as a gap nobody could use.
     */
    const besideColumns = Math.floor(
        (bodyWidth - BODY_GAP - TICKET_MIN_WIDTH + TILE_GAP) / (TILE_WIDTH + TILE_GAP),
    );
    const sideBySide = besideColumns >= 2;
    const grid = sideBySide
        ? { columns: besideColumns, tileWidth: TILE_WIDTH }
        : stackedGrid(bodyWidth);
    const menuWidth = grid.columns * grid.tileWidth + (grid.columns - 1) * TILE_GAP;
    // The menu and the checkout take the same column.
    const column = sideBySide ? { width: menuWidth } : { alignSelf: 'stretch' as const };

    if (isEditing && editOrder === null) {
        const failure = toFailure(editing.error);
        return failure === null ? (
            <Skeleton testID="kitchen-order-desk-sale-edit-loading" heightClassName="h-32" />
        ) : (
            <ErrorState
                testID="kitchen-order-desk-sale-edit-error"
                title={t('kitchen:desk.edit.loadErrorTitle')}
                failure={failure}
                onRetry={() => {
                    void editing.refetch();
                }}
                retrying={editing.isFetching}
            />
        );
    }

    // The server decides; once it says no, there is nothing on this page worth editing.
    if (editOrder !== null && !editOrder.amendable && !editDirty) {
        return (
            <Callout
                testID="kitchen-order-desk-sale-not-amendable"
                tone="warning"
                role="alert"
                title={t('kitchen:desk.edit.notAmendableTitle')}
                body={t('kitchen:desk.edit.notAmendableBody')}
                actions={
                    <Button
                        testID="kitchen-order-desk-sale-not-amendable-back"
                        size="sm"
                        variant="secondary"
                        label={t('kitchen:desk.edit.backToDesk')}
                        onPress={() => {
                            router.replace('/kitchen/order-desk');
                        }}
                    />
                }
            />
        );
    }

    /*
     * A total the server could not work out is said under the ticket's total; it clears when the
     * quote is asked again. The page has no issue tray — taken off it on 2026-10-28 — so this and
     * the customer cards' warnings are drawn where they apply.
     */
    const quoteFailure = state.lines.length === 0 ? null : toFailure(ticketQuote.error);

    return (
        <View testID="kitchen-order-desk-sale-screen" className="z-auto flex-col gap-base">
            {editOrder === null ? null : (
                <Text variant="title" testID="kitchen-order-desk-sale-editing">
                    {t('kitchen:desk.edit.title', { number: editOrder.orderNumber })}
                </Text>
            )}
            <View
                // Both measurement paths, each inert on the other's platform — as `CatalogueList`.
                ref={Platform.OS === 'web' ? port.ref : undefined}
                onLayout={Platform.OS === 'web' ? undefined : port.onLayout}
                className={
                    sideBySide ? 'z-auto flex-row items-start gap-base' : 'z-auto flex-col gap-base'
                }
            >
                {/*
                 * Both columns stay mounted and the stage hides one: Back must find the customer and
                 * the address cards as they were left, folded, not reset to an empty search.
                 */}
                <View
                    testID="kitchen-order-desk-sale-checkout"
                    className="z-auto min-w-0 flex-col gap-base"
                    style={[column, stage === 'checkout' ? null : HIDDEN]}
                >
                    <View className="flex-row">
                        <Button
                            testID="kitchen-order-desk-sale-back"
                            size="sm"
                            variant="secondary"
                            label={t('kitchen:desk.sale.backToMenu')}
                            iconStart={<Icon name="chevronBackward" size="sm" />}
                            onPress={() => {
                                setStage('menu');
                            }}
                        />
                    </View>

                    {/* How it leaves and who it is for are fixed for the life of an order. */}
                    {isEditing ? null : (
                        <KindPicker
                            value={kindChosen ? state.fulfilmentType : null}
                            onChange={(type) => {
                                setKindChosen(true);
                                update(withFulfilmentType(state, type));
                            }}
                        />
                    )}

                    <>
                        {!isEditing && kindChosen && needsCustomer(state.fulfilmentType) ? (
                            <CustomerSection
                                customerAccountId={state.customerAccountId}
                                onChoose={(customer) => {
                                    update(withCustomer(state, customer.id));
                                }}
                            />
                        ) : null}

                        {editOrder !== null && needsAddress(state.fulfilmentType) ? (
                            <FormSection
                                variant="card"
                                testID="kitchen-order-desk-sale-edit-address"
                                title={t('kitchen:desk.sale.addressTitle')}
                                actions={
                                    <Button
                                        testID="kitchen-order-desk-sale-edit-address-toggle"
                                        size="sm"
                                        variant="secondary"
                                        label={t(
                                            changingAddress
                                                ? 'kitchen:desk.edit.keepAddress'
                                                : 'kitchen:desk.edit.changeAddress',
                                        )}
                                        onPress={() => {
                                            // Keeping the stored address drops one added meanwhile.
                                            if (
                                                changingAddress &&
                                                state.customerAddressId !== null
                                            ) {
                                                update({ ...state, customerAddressId: null });
                                            }
                                            setChangingAddress(!changingAddress);
                                        }}
                                    />
                                }
                            >
                                <Text
                                    variant="label"
                                    testID="kitchen-order-desk-sale-edit-address-current"
                                >
                                    {[
                                        editOrder.delivery.lineOne,
                                        editOrder.delivery.lineTwo,
                                        locale.startsWith('ar')
                                            ? editOrder.delivery.areaNameAr
                                            : editOrder.delivery.areaNameEn,
                                    ]
                                        .filter(
                                            (part): part is string => part !== null && part !== '',
                                        )
                                        .join(', ') || EM_DASH}
                                </Text>
                            </FormSection>
                        ) : null}

                        {/*
                         * The same surface a new sale uses, unchanged: it only ever adds an address,
                         * and on an edit the one it adds replaces the stored destination.
                         */}
                        {kindChosen &&
                        needsAddress(state.fulfilmentType) &&
                        (!isEditing || changingAddress) ? (
                            <AddressSection
                                customerAccountId={state.customerAccountId}
                                customerAddressId={state.customerAddressId}
                                onSaved={(addressId) => {
                                    update({ ...state, customerAddressId: addressId });
                                }}
                            />
                        ) : null}
                    </>

                    {!kindChosen || schedule === null ? null : (
                        <WhenSection
                            windows={windowList}
                            zoneOffersNone={offeredCodes !== null && windowList.length === 0}
                            schedule={schedule}
                            ended={schedule.requestedDeliveryDate === today ? overToday : new Set()}
                            firstDay={firstOpenDay(today, windowCodes, overToday)}
                            onSchedule={(next) => {
                                update({ ...state, ...next });
                            }}
                            // An edit leaves the run to the record page's own reassignment.
                            drivers={
                                !isEditing && state.fulfilmentType === 'delivery'
                                    ? (drivers.data?.rows ?? null)
                                    : null
                            }
                            driverUserId={state.driverUserId}
                            onDriver={(driverUserId) => {
                                update({ ...state, driverUserId });
                            }}
                        />
                    )}
                </View>

                <View
                    className="z-auto min-w-0 flex-col gap-snug"
                    style={[column, stage === 'menu' ? null : HIDDEN]}
                >
                    <CatalogueToolbar<MenuSection>
                        testID="kitchen-order-desk-sale-menu-toolbar"
                        search={query}
                        onSearchChange={setQuery}
                        searchLabel={t('kitchen:desk.sale.pickerSearchLabel')}
                        searchPlaceholder={t('kitchen:desk.sale.pickerSearchPlaceholder')}
                        statusLabel={t('kitchen:desk.sale.sectionsLabel')}
                        statusSegments={MENU_SECTIONS.map((candidate) => ({
                            value: candidate,
                            label: t(SECTION_LABEL_KEYS[candidate]),
                        }))}
                        status={section}
                        onStatusChange={setSection}
                    />
                    <MenuGrid
                        tileWidth={grid.tileWidth}
                        columns={grid.columns}
                        section={section}
                        query={query}
                        customerAccountId={state.customerAccountId}
                        amendingOrderId={editOrderId === null ? null : String(editOrderId)}
                        lines={state.lines}
                        onAdd={(tile) => {
                            update({
                                ...state,
                                lines: addItem(state.lines, {
                                    catalogueItemId: tile.id,
                                    catalogueItemVariantId: null,
                                    name: tile.name,
                                    variantLabel: null,
                                }),
                            });
                        }}
                    />
                </View>

                <Ticket
                    beside={sideBySide}
                    stage={stage}
                    kindChosen={kindChosen}
                    onCharge={() => {
                        setStage('checkout');
                    }}
                    state={state}
                    quote={quote}
                    quoteStale={quoteStale}
                    quoteFailure={quoteFailure?.message ?? null}
                    onState={update}
                    sold={sold}
                    editing={editOrder}
                    onReload={onReload}
                    placing={place.isPending || amend.isPending}
                    placeFailure={toFailure(isEditing ? amend.error : place.error)}
                    onPlace={isEditing ? onSave : onPlace}
                />
            </View>
            <EditorGuardDialogs guard={guard} testID="kitchen-order-desk-sale-screen" />
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * How the order leaves
 * ---------------------------------------------------------------------------------------------- */

/**
 * Counter, collection or delivery, as three cards side by side — the checkout's first question.
 * `null` is "not chosen yet": nothing is preselected, because a sale that leaves the wrong way is
 * not a slip the till should make on the agent's behalf. The tiles are the Catalogue's own
 * `ChoiceTiles`, which say under each choice what it will ask for.
 */
function KindPicker({
    value,
    onChange,
}: {
    readonly value: OrderDeskFulfilmentType | null;
    readonly onChange: (type: OrderDeskFulfilmentType) => void;
}) {
    const { t } = useTranslation();

    return (
        <FormSection
            variant="card"
            testID="kitchen-order-desk-sale-kind-card"
            title={t('kitchen:desk.sale.kindTitle')}
        >
            <ChoiceTiles<OrderDeskFulfilmentType>
                testID="kitchen-order-desk-sale-kind"
                label={t('kitchen:desk.sale.typeLabel')}
                value={value}
                onChange={onChange}
                tiles={ORDER_DESK_FULFILMENT_TYPES.map((candidate) => ({
                    value: candidate,
                    title: t(FULFILMENT_LABEL_KEYS[candidate]),
                    body: t(`kitchen:desk.sale.typeHint.${candidate}`),
                }))}
            />
        </FormSection>
    );
}

/* ------------------------------------------------------------------------------------------------
 * When, and who drives it
 * ---------------------------------------------------------------------------------------------- */

/** The driver picker's "nobody yet" option. Not a uuid, so it can never name a member. */
const NO_DRIVER = 'none';

/**
 * The day and slot a collection or delivery is cooked for, and on a delivery the optional driver.
 * Defaults to today and the kitchen's default slot (`scheduleFor`), so the agent only touches this
 * when the caller asks for another day.
 */
function WhenSection({
    windows,
    zoneOffersNone,
    schedule,
    ended,
    firstDay,
    onSchedule,
    drivers,
    driverUserId,
    onDriver,
}: {
    readonly windows: readonly OrderDeskDeliveryWindow[];
    /** The address's zone offers none of the kitchen's windows — a different sentence from "none set up". */
    readonly zoneOffersNone: boolean;
    readonly schedule: NonNullable<ReturnType<typeof scheduleFor>>;
    /**
     * The slots already over on the chosen day — today's, by their end time. Shown but not
     * choosable: at 3 PM only Snack and Dinner can still be cooked for today.
     */
    readonly ended: ReadonlySet<string>;
    /** The earliest day the picker offers: tomorrow once every slot today is over. */
    readonly firstDay: string;
    readonly onSchedule: (
        next: Pick<SaleState, 'requestedDeliveryDate' | 'deliveryWindowCode'>,
    ) => void;
    /** `null` when this is not a delivery, nobody here may assign, or the list is not in yet. */
    readonly drivers: readonly OrderDeskDriver[] | null;
    readonly driverUserId: string | null;
    readonly onDriver: (driverUserId: string | null) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();

    return (
        <FormSection
            variant="card"
            testID="kitchen-order-desk-sale-when"
            title={t('kitchen:desk.sale.whenLabel')}
        >
            {/* The day and the slot are two questions, so they sit a block apart, not a line. */}
            {/*
             * `z-auto` on both rows: the date's month panel opens over the slot chips below it, and
             * React Native Web's default `z-index: 0` would bury it under them.
             */}
            <View className="z-auto flex-col gap-base">
                <View className="z-auto flex-row flex-wrap items-end gap-snug">
                    <DatePickerButton
                        testID="kitchen-order-desk-sale-date"
                        label={t('kitchen:desk.sale.dateLabel')}
                        labelVisible
                        // The When card is the checkout's last: opened downward, the month runs
                        // past the foot of the column and has to be scrolled to.
                        side="above"
                        value={schedule.requestedDeliveryDate}
                        min={firstDay}
                        onChange={(requestedDeliveryDate) => {
                            onSchedule({
                                requestedDeliveryDate,
                                deliveryWindowCode: schedule.deliveryWindowCode,
                            });
                        }}
                    />
                    {drivers === null ? null : (
                        // The field's own width, as every admin field has: unbounded, the hint
                        // sentence stretched the list across the card.
                        <View className="z-auto" style={{ width: fieldWidth }}>
                            <Select<string>
                                testID="kitchen-order-desk-sale-driver"
                                label={t('kitchen:desk.sale.driverLabel')}
                                hint={t('kitchen:desk.sale.driverHint')}
                                size="sm"
                                value={driverUserId ?? NO_DRIVER}
                                options={[
                                    { value: NO_DRIVER, label: t('kitchen:desk.sale.driverNone') },
                                    ...drivers.map((driver) => ({
                                        value: driver.userId,
                                        label: driver.displayName ?? EM_DASH,
                                    })),
                                ]}
                                onChange={(value) => {
                                    onDriver(value === NO_DRIVER ? null : value);
                                }}
                            />
                        </View>
                    )}
                </View>
                {windows.length === 0 ? (
                    <Text
                        testID="kitchen-order-desk-sale-no-slots"
                        variant="caption"
                        tone="secondary"
                    >
                        {t(
                            zoneOffersNone
                                ? 'kitchen:desk.sale.zoneNoSlots'
                                : 'kitchen:desk.sale.noSlots',
                        )}
                    </Text>
                ) : (
                    <View
                        testID="kitchen-order-desk-sale-slot"
                        role="radiogroup"
                        aria-label={t('kitchen:desk.sale.slotLabel')}
                        className="flex-row flex-wrap gap-tight"
                    >
                        {windows.map((window) => {
                            const selected = schedule.deliveryWindowCode === window.code;
                            const over = ended.has(window.code);
                            const name = locale.startsWith('ar') ? window.nameAr : window.nameEn;
                            const hours =
                                window.startsAt === null || window.endsAt === null
                                    ? null
                                    : t('kitchen:desk.sale.slotHours', {
                                          from: window.startsAt,
                                          to: window.endsAt,
                                      });
                            return (
                                <Pressable
                                    key={window.code}
                                    testID={`kitchen-order-desk-sale-slot-${window.code}`}
                                    role="radio"
                                    accessibilityRole="radio"
                                    aria-checked={selected}
                                    aria-disabled={over}
                                    accessibilityState={{ checked: selected, disabled: over }}
                                    disabled={over}
                                    aria-label={hours === null ? name : `${name}. ${hours}`}
                                    onPress={() => {
                                        onSchedule({
                                            requestedDeliveryDate: schedule.requestedDeliveryDate,
                                            deliveryWindowCode: window.code,
                                        });
                                    }}
                                    className={
                                        over
                                            ? 'h-control-md flex-row items-center gap-hair rounded-sm border border-stroke-subtle bg-surface-sunken px-control-sm opacity-60'
                                            : selected
                                              ? 'h-control-md flex-row items-center gap-hair rounded-sm border border-surface-brand bg-surface-brand-subtle px-control-sm'
                                              : 'h-control-md flex-row items-center gap-hair rounded-sm border border-stroke bg-surface-raised px-control-sm web:hover:border-surface-brand'
                                    }
                                >
                                    <Text variant="label" numberOfLines={1}>
                                        {name}
                                    </Text>
                                    {hours === null ? null : (
                                        <Text variant="mono" tone="secondary" numberOfLines={1}>
                                            {hours}
                                        </Text>
                                    )}
                                </Pressable>
                            );
                        })}
                    </View>
                )}
            </View>
        </FormSection>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The menu
 * ---------------------------------------------------------------------------------------------- */

/**
 * The grid when the menu runs the full width above the ticket: as many columns as fit at the
 * minimum tile width, and the tiles stretched to fill the row between them. Before the first
 * measurement there is no row to fill, so the tiles take their minimum.
 */
function stackedGrid(width: number): { readonly columns: number; readonly tileWidth: number } {
    const columns = Math.max(1, Math.floor((width + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP)));
    const tileWidth = width === 0 ? TILE_MIN_WIDTH : (width - TILE_GAP * (columns - 1)) / columns;
    return { columns, tileWidth };
}

function MenuGrid({
    tileWidth,
    columns,
    section,
    query,
    customerAccountId,
    amendingOrderId,
    lines,
    onAdd,
}: {
    /** Worked out by the screen, which knows the row the menu shares with the ticket. */
    readonly tileWidth: number;
    /** How many tiles a row holds — a page is whole rows of them. */
    readonly columns: number;
    readonly section: MenuSection;
    readonly query: string;
    readonly customerAccountId: string | null;
    /** On an edit, the shelf is priced on that order's channel — a web-shop order's, say. */
    readonly amendingOrderId: string | null;
    readonly lines: readonly BasketLine[];
    readonly onAdd: (tile: MenuTile) => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const debounced = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
    /* Published only: a desk sells what is on sale. */
    const base = useMemo(
        () => ({
            statuses: ['published'] as const,
            ...(debounced === '' ? {} : { query: debounced }),
        }),
        [debounced],
    );
    const productFilter = useMemo(
        () => (section === 'meals' ? base : { ...base, itemType: section }),
        [base, section],
    );

    // Only the section on screen is read. The others load when somebody opens them.
    /*
     * Whole rows: the catalogue's eighteen, rounded up to the grid. Eighteen on four columns left
     * the last row two tiles short and sent the nineteenth meal to a page of its own while the room
     * for it sat empty on this one.
     */
    const perPage = columns * Math.ceil(KITCHEN_PAGE_SIZE / columns);

    /*
     * The page, held against the section, search and page size it was turned for: changing any of
     * them starts on page one without an effect to reset it — a wider row is a bigger page, and the
     * page turned to may no longer exist.
     */
    const pageFor = `${section}|${debounced}|${String(perPage)}`;
    const [turned, setTurned] = useState({ pageFor, page: 1 });
    const page = turned.pageFor === pageFor ? turned.page : 1;

    const meals = useAdminMealPageQuery(base, page, section === 'meals', perPage);
    const products = useProductPageQuery(productFilter, page, section !== 'meals', perPage);
    const read = section === 'meals' ? meals : products;

    const tiles = useMemo<readonly MenuTile[]>(
        () =>
            (read.data?.items ?? []).map((row) => ({
                id: String(row.id),
                name: row.name,
                imageId: row.imagePlaceholderId,
                photoUrl: row.photoUrl ?? row.recipePhotoUrl ?? null,
            })),
        [read.data],
    );

    /*
     * One of each on screen, quoted as a counter basket — see the file header. As a counter sale
     * because the lines are priced on the desk channel whatever the kind, and a counter body asks
     * no address; with the customer, because their price lists can differ from a stranger's.
     */
    const shelfRequest = useMemo<OrderDeskSaleRequest | null>(
        () =>
            tiles.length === 0
                ? null
                : {
                      fulfilmentType: 'counter',
                      lines: tiles.map((tile) => ({
                          catalogueItemId: tile.id,
                          catalogueItemVariantId: null,
                          quantity: '1',
                      })),
                      ...(customerAccountId === null ? {} : { customerAccountId }),
                      ...(amendingOrderId === null ? {} : { amendingOrderId }),
                  },
        [tiles, customerAccountId, amendingOrderId],
    );
    const shelf = useOrderDeskQuoteQuery(shelfRequest);
    const shelfById = useMemo(() => {
        const map = new Map<string, OrderDeskQuoteLine>();
        for (const line of shelf.data?.lines ?? []) {
            if (line.catalogueItemVariantId === null) map.set(line.catalogueItemId, line);
        }
        return map;
    }, [shelf.data]);

    const quantities = useMemo(() => {
        const map = new Map<string, number>();
        for (const line of lines) {
            if (line.catalogueItemVariantId === null) {
                map.set(line.catalogueItemId, quantityAsNumber(line.quantity) ?? 0);
            }
        }
        return map;
    }, [lines]);

    const failure = toFailure(read.error);
    const totalPages = pagesInResultOf(read.data, perPage) ?? 0;

    return (
        <View testID="kitchen-order-desk-sale-menu" className="flex-col gap-snug">
            {read.isPending ? (
                <Skeleton testID="kitchen-order-desk-sale-menu-loading" heightClassName="h-32" />
            ) : failure !== null ? (
                <ErrorState
                    testID="kitchen-order-desk-sale-menu-error"
                    title={t('kitchen:desk.sale.pickerErrorTitle')}
                    failure={failure}
                    onRetry={() => {
                        void read.refetch();
                    }}
                    retrying={read.isFetching}
                />
            ) : tiles.length === 0 ? (
                <EmptyState
                    testID="kitchen-order-desk-sale-menu-empty"
                    title={t('kitchen:desk.sale.pickerEmptyTitle')}
                    body={t('kitchen:desk.sale.pickerEmptyBody')}
                />
            ) : (
                <>
                    <View className="flex-row flex-wrap gap-snug">
                        {tiles.map((tile) => {
                            const quoted = shelfById.get(tile.id) ?? null;
                            return (
                                <MenuTileButton
                                    key={tile.id}
                                    tile={tile}
                                    name={displayName(tile.name, locale).value}
                                    width={tileWidth}
                                    price={
                                        quoted?.unitPriceMinor == null
                                            ? null
                                            : formatMoney(formatter, {
                                                  amount: quoted.unitPriceMinor,
                                                  currency: quoted.currencyCode,
                                              })
                                    }
                                    refused={quoted !== null && quoted.refusals.length > 0}
                                    count={quantities.get(tile.id) ?? 0}
                                    onAdd={() => {
                                        onAdd(tile);
                                    }}
                                />
                            );
                        })}
                    </View>
                    <CataloguePager
                        testID="kitchen-order-desk-sale-menu-pager"
                        label={t('kitchen:catalogue.pagerLabel')}
                        page={page}
                        totalPages={totalPages}
                        onPageChange={(next) => {
                            setTurned({ pageFor, page: next });
                        }}
                    />
                </>
            )}
        </View>
    );
}

/**
 * One product on the menu: its photograph, its name over its price, and how many are on the ticket.
 * The name is the tile's title, so it is set a step above the price.
 */
function MenuTileButton({
    tile,
    name,
    width,
    price,
    refused,
    count,
    onAdd,
}: {
    readonly tile: MenuTile;
    readonly name: string;
    readonly width: number;
    /** The quoted price of one, or `null` while it is being asked. */
    readonly price: string | null;
    /** The desk does not sell this — the shelf quote refused it. */
    readonly refused: boolean;
    readonly count: number;
    readonly onAdd: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const label = [
        price === null
            ? t('kitchen:desk.sale.addItem', { item: name })
            : t('kitchen:desk.sale.addItemPriced', { item: name, price }),
        count > 0 ? t('kitchen:desk.sale.onTicket', { count }) : null,
        refused ? t('kitchen:desk.sale.notSold') : null,
    ]
        .filter((part) => part !== null)
        .join('. ');

    return (
        <Pressable
            testID={`kitchen-order-desk-sale-tile-${tile.id}`}
            role="button"
            accessibilityRole="button"
            aria-label={label}
            accessibilityLabel={label}
            aria-disabled={refused}
            accessibilityState={{ disabled: refused }}
            disabled={refused}
            onPress={onAdd}
            style={{ width }}
            className={
                refused
                    ? 'relative flex-col overflow-hidden rounded border border-stroke-subtle bg-surface-sunken opacity-60'
                    : 'relative flex-col overflow-hidden rounded border border-stroke-subtle bg-surface-raised shadow-elevation-card active:opacity-80 web:hover:border-surface-brand'
            }
        >
            <EntityImage
                testID={`kitchen-order-desk-sale-tile-${tile.id}-image`}
                assetId={tile.imageId}
                photoUrl={tile.photoUrl}
                seed={tile.id}
                label={name}
                aspect="card"
                decorative
                flush
            />
            <View className="flex-col gap-hair px-tight pb-tight pt-tight">
                <Text variant="strong" numberOfLines={2}>
                    {name}
                </Text>
                <Text
                    variant="mono"
                    tone={refused ? 'secondary' : 'brand'}
                    testID={`kitchen-order-desk-sale-tile-${tile.id}-price`}
                >
                    {refused ? t('kitchen:desk.sale.notSold') : (price ?? EM_DASH)}
                </Text>
            </View>
            {count > 0 ? (
                <View className="absolute end-1.5 top-1.5" aria-hidden>
                    <Badge
                        testID={`kitchen-order-desk-sale-tile-${tile.id}-count`}
                        tone="brand"
                        icon={null}
                        label={formatter.formatNumber(count)}
                    />
                </View>
            ) : null}
        </Pressable>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The ticket
 * ---------------------------------------------------------------------------------------------- */

/** A refusal from the quote or the placement — the same `{ reason, context }` either way. */
type Refusal = OrderDeskQuote['refusals'][number];

function Ticket({
    beside,
    stage,
    kindChosen,
    onCharge,
    state,
    quote,
    quoteStale,
    quoteFailure,
    onState,
    sold,
    editing,
    onReload,
    placing,
    placeFailure,
    onPlace,
}: {
    /** Beside the menu, taking the row the tiles leave; otherwise the full width under it. */
    readonly beside: boolean;
    readonly stage: SaleStage;
    /** Whether the checkout's first question is answered; until then nothing is offered to pay. */
    readonly kindChosen: boolean;
    /** Charge, from the menu: opens the checkout. */
    readonly onCharge: () => void;
    readonly state: SaleState;
    readonly quote: OrderDeskQuote | null;
    readonly quoteStale: boolean;
    /** Why the ticket's total could not be worked out, or `null`. */
    readonly quoteFailure: string | null;
    readonly onState: (state: SaleState) => void;
    readonly sold: KitchenOrder | null;
    /** The order being edited, or `null` on a new sale. */
    readonly editing: KitchenOrder | null;
    /** Re-seeds the edit after a `409 resource.conflict`. */
    readonly onReload: () => void;
    readonly placing: boolean;
    readonly placeFailure: ReturnType<typeof toFailure>;
    readonly onPlace: () => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    /*
     * Beside the menu the ticket is sticky, and a sticky box taller than the screen cannot be
     * scrolled to its own bottom — which is where Charge is. So its lines scroll inside it, capped at
     * what the window leaves once the ticket's own header, totals and buttons are counted, and the
     * totals and Charge stay in view on a 720p laptop's ~600px. Never below three lines' worth.
     */
    const { height: windowHeight } = useWindowDimensions();
    const linesMaxHeight = Math.max(TICKET_LINES_MIN_HEIGHT, windowHeight - TICKET_CHROME_HEIGHT);

    const money = (amount: number, currency: OrderDeskQuote['currencyCode']) =>
        formatMoney(formatter, { amount, currency });

    /*
     * A refusal's sentence. The two an edit adds carry their own detail: `order_not_amendable` says
     * why in `because`, and `total_below_paid` the amounts — in the edited order's currency.
     */
    const refusalText = (refusal: Refusal): string => {
        if (refusal.reason === 'order_not_amendable') {
            const because = String(refusal.context['because'] ?? 'closed');
            return t(`kitchen:desk.edit.notAmendable.${because}`, {
                defaultValue: t('kitchen:desk.edit.notAmendableTitle'),
            });
        }
        if (refusal.reason === 'total_below_paid' && editing !== null) {
            return t('kitchen:desk.edit.totalBelowPaid', {
                total: money(Number(refusal.context['total_minor']), editing.currencyCode),
                paid: money(Number(refusal.context['paid_minor']), editing.currencyCode),
            });
        }
        return t(`kitchen:desk.refusal.${refusal.reason}`, { defaultValue: refusal.reason });
    };

    const quotedByKey = useMemo(() => {
        const map = new Map<string, OrderDeskQuoteLine>();
        for (const line of quote?.lines ?? []) {
            map.set(basketKey(line.catalogueItemId, line.catalogueItemVariantId), line);
        }
        return map;
    }, [quote]);

    const lines = state.lines;
    const counter = state.fulfilmentType === 'counter';
    const itemCount = lines.reduce((sum, line) => sum + (quantityAsNumber(line.quantity) ?? 0), 0);
    const shortfall = saleShortfall(state, editing !== null);
    const refusalReasons =
        placeFailure?.code === 'order.placement_refused' ? placeFailure.reasons : [];
    // An edit sent against a version somebody else has since moved.
    const conflicted = editing !== null && placeFailure?.code === 'resource.conflict';

    // The two gates: nothing missing on the page, and a fresh price the server says it can sell.
    const placeable = shortfall === null && quote !== null && quote.quotable && !quoteStale;

    /*
     * Charge asks less: food the desk will sell, freshly priced. It does not wait for the whole
     * quote to be `quotable`, because an order-level refusal — no customer on a collection — is
     * about how the order leaves, which is what the checkout behind this button settles.
     */
    const chargeable =
        isQuotableBasket(lines) &&
        quote !== null &&
        !quoteStale &&
        quote.lines.every((line) => line.refusals.length === 0);
    const chargeLabel =
        lines.length === 0
            ? t('kitchen:desk.sale.chargeEmpty')
            : quote === null || quoteStale
              ? t('kitchen:desk.sale.quoteUpdating')
              : t(editing !== null ? 'kitchen:desk.edit.review' : 'kitchen:desk.sale.chargeTotal', {
                    total: money(quote.totalMinor, quote.currencyCode),
                });
    const paying = stage === 'checkout' && kindChosen;

    const actionLabel =
        lines.length === 0
            ? t('kitchen:desk.sale.chargeEmpty')
            : quote === null || quoteStale
              ? t('kitchen:desk.sale.quoteUpdating')
              : editing !== null
                ? t('kitchen:desk.edit.save', {
                      total: money(quote.totalMinor, quote.currencyCode),
                  })
                : counter
                  ? t('kitchen:desk.sale.charge', {
                        total: money(quote.totalMinor, quote.currencyCode),
                        method: t(kitchenOrderPaymentMethodKey(state.paymentMethod)),
                    })
                  : t('kitchen:desk.sale.placeFor', {
                        total: money(quote.totalMinor, quote.currencyCode),
                    });

    return (
        <View
            testID="kitchen-order-desk-sale-ticket"
            role="complementary"
            aria-label={t('kitchen:desk.sale.ticketTitle')}
            style={beside ? { minWidth: TICKET_MIN_WIDTH } : undefined}
            className={
                beside
                    ? // eslint-disable-next-line no-restricted-syntax -- the ticket is the row's filler beside the fixed-width menu.
                      'z-auto min-w-0 flex-1 self-start web:sticky web:top-0'
                    : 'z-auto self-stretch web:sticky web:top-0'
            }
        >
            <FormSection
                variant="card"
                testID="kitchen-order-desk-sale-ticket-card"
                title={t('kitchen:desk.sale.ticketTitle')}
                aside={
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID="kitchen-order-desk-sale-ticket-count"
                    >
                        {t('kitchen:desk.sale.itemCount', { count: itemCount })}
                    </Text>
                }
            >
                <View className="flex-col gap-snug">
                    {sold === null ? null : (
                        <Callout
                            testID="kitchen-order-desk-sale-sold"
                            tone="success"
                            role="status"
                            title={t('kitchen:desk.sale.completedNumber', {
                                number: sold.orderNumber,
                            })}
                            body={t('kitchen:desk.sale.soldBody', {
                                total: money(sold.totalMinor, sold.currencyCode),
                            })}
                        />
                    )}

                    {lines.length === 0 ? (
                        <Text
                            variant="body"
                            tone="secondary"
                            testID="kitchen-order-desk-sale-ticket-empty"
                        >
                            {t('kitchen:desk.sale.ticketEmpty')}
                        </Text>
                    ) : (
                        <ScrollView
                            testID="kitchen-order-desk-sale-lines"
                            style={beside ? { maxHeight: linesMaxHeight } : undefined}
                            contentContainerClassName="flex-col"
                        >
                            {lines.map((line) => {
                                const key = lineKey(line);
                                const quoted = quotedByKey.get(key) ?? null;
                                const name = displayName(line.name, locale).value;
                                const quantity = quantityAsNumber(line.quantity) ?? 1;
                                const refusals = quoted?.refusals ?? [];
                                const step = (next: number) => {
                                    // Stepping below one takes the line off, as the basket does.
                                    onState({
                                        ...state,
                                        lines: setQuantity(lines, key, quantityFromNumber(next)),
                                    });
                                };
                                return (
                                    <View
                                        key={key}
                                        testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}`}
                                        role="group"
                                        aria-label={name}
                                        className="flex-col gap-hair border-b border-stroke-subtle py-tight"
                                    >
                                        <View className="flex-row items-center gap-tight">
                                            {/* eslint-disable-next-line no-restricted-syntax -- the name is the line's filler. */}
                                            <View className="min-w-0 flex-1 flex-col">
                                                <Text variant="label" numberOfLines={2}>
                                                    {name}
                                                </Text>
                                                <Text variant="caption" tone="secondary">
                                                    {quoted?.unitPriceMinor == null
                                                        ? EM_DASH
                                                        : t('kitchen:desk.sale.each', {
                                                              price: money(
                                                                  quoted.unitPriceMinor,
                                                                  quoted.currencyCode,
                                                              ),
                                                          })}
                                                </Text>
                                            </View>
                                            <View className="flex-row items-center gap-hair">
                                                <IconButton
                                                    testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-decrement`}
                                                    icon={<Icon name="minus" size="sm" />}
                                                    variant="secondary"
                                                    size="sm"
                                                    label={t(
                                                        'designSystem:numberStepper.decrease',
                                                        {
                                                            label: name,
                                                        },
                                                    )}
                                                    onPress={() => {
                                                        step(quantity - 1);
                                                    }}
                                                />
                                                <View style={{ width: LINE_QUANTITY_WIDTH }}>
                                                    <Text
                                                        variant="mono"
                                                        align="center"
                                                        aria-live="polite"
                                                        testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-quantity`}
                                                    >
                                                        {formatter.formatNumber(quantity)}
                                                    </Text>
                                                </View>
                                                <IconButton
                                                    testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-increment`}
                                                    icon={<Icon name="plus" size="sm" />}
                                                    variant="secondary"
                                                    size="sm"
                                                    label={t(
                                                        'designSystem:numberStepper.increase',
                                                        {
                                                            label: name,
                                                        },
                                                    )}
                                                    disabled={quantity >= MAX_LINE_QUANTITY}
                                                    onPress={() => {
                                                        step(quantity + 1);
                                                    }}
                                                />
                                            </View>
                                            <View
                                                className="shrink-0"
                                                style={{ width: LINE_TOTAL_WIDTH }}
                                            >
                                                <Text
                                                    variant="mono"
                                                    align="end"
                                                    tone={
                                                        refusals.length > 0 ? 'warning' : 'primary'
                                                    }
                                                    testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-total`}
                                                >
                                                    {quoted?.lineTotalMinor == null
                                                        ? EM_DASH
                                                        : money(
                                                              quoted.lineTotalMinor,
                                                              quoted.currencyCode,
                                                          )}
                                                </Text>
                                            </View>
                                        </View>
                                        {refusals.map((refusal) => (
                                            <Text
                                                key={refusal.reason}
                                                variant="caption"
                                                tone="warning"
                                                testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-refusal-${refusal.reason}`}
                                            >
                                                {refusalText(refusal)}
                                            </Text>
                                        ))}
                                        {/* A warning, never a block: the sale can still go ahead. */}
                                        {(quoted?.heldStock ?? []).length === 0 ? null : (
                                            <Text
                                                variant="caption"
                                                tone="warning"
                                                testID={`kitchen-order-desk-sale-line-${line.catalogueItemId}-held`}
                                            >
                                                {t('kitchen:desk.sale.heldStock', {
                                                    names: (quoted?.heldStock ?? []).join(
                                                        t('kitchen:common.listSeparator'),
                                                    ),
                                                })}
                                            </Text>
                                        )}
                                    </View>
                                );
                            })}
                        </ScrollView>
                    )}

                    {lines.length === 0 ? null : (
                        <Totals
                            quote={quote}
                            quoteFailure={quoteFailure}
                            money={money}
                            showOrderRefusals={paying}
                            refusalText={refusalText}
                        />
                    )}

                    {paying ? (
                        <PaymentMethods
                            type={state.fulfilmentType}
                            value={state.paymentMethod}
                            onChange={(method) => {
                                onState(withPaymentMethod(state, method));
                            }}
                        />
                    ) : null}

                    {paying && counter && state.payment?.method === 'wish' ? (
                        <TextInputField
                            testID="kitchen-order-desk-sale-reference"
                            id="kitchen-order-desk-sale-reference"
                            label={t('kitchen:desk.sale.referenceLabel')}
                            hint={t('kitchen:desk.sale.referenceHint')}
                            placeholder={t('kitchen:desk.sale.referencePlaceholder')}
                            size="sm"
                            required
                            value={state.payment.reference}
                            onChangeText={(reference) => {
                                if (state.payment === null) return;
                                onState({ ...state, payment: { ...state.payment, reference } });
                            }}
                            autoCapitalize="characters"
                            autoCorrect={false}
                        />
                    ) : null}

                    {placeFailure === null ? null : conflicted ? (
                        // Never a silent retry: re-read and show what actually happened.
                        <Callout
                            testID="kitchen-order-desk-sale-conflict"
                            tone="warning"
                            role="alert"
                            title={t('kitchen:ops.orders.conflictTitle')}
                            body={t('kitchen:ops.orders.conflictBody')}
                            actions={
                                <Button
                                    testID="kitchen-order-desk-sale-conflict-reload"
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:ops.orders.conflictRefresh')}
                                    onPress={onReload}
                                />
                            }
                        />
                    ) : (
                        <Callout
                            testID="kitchen-order-desk-sale-refusal"
                            tone="danger"
                            role="alert"
                            title={t('kitchen:desk.sale.refusedTitle')}
                        >
                            {refusalReasons.length === 0 ? null : (
                                <View
                                    testID="kitchen-order-desk-sale-refusal-reasons"
                                    className="flex-col gap-hair"
                                >
                                    {/*
                                     * Every reason, never just the first: one sentence saying the
                                     * order could not be placed sends an agent back to a ticket with
                                     * nothing to change. A reason with no copy yet still appears, as
                                     * the server's own code.
                                     */}
                                    {refusalReasons.map((entry) => (
                                        <Text
                                            key={entry.reason}
                                            variant="caption"
                                            testID={`kitchen-order-desk-sale-refusal-${entry.reason}`}
                                        >
                                            {`• ${refusalText(entry)}`}
                                        </Text>
                                    ))}
                                </View>
                            )}
                        </Callout>
                    )}

                    {stage === 'menu' ? (
                        <Button
                            testID="kitchen-order-desk-sale-charge"
                            size="md"
                            block
                            label={chargeLabel}
                            disabled={!chargeable}
                            onPress={onCharge}
                        />
                    ) : !kindChosen ? (
                        <Text
                            variant="caption"
                            tone="secondary"
                            align="center"
                            testID="kitchen-order-desk-sale-kind-pending"
                        >
                            {t('kitchen:desk.sale.kindPending')}
                        </Text>
                    ) : (
                        <View className="flex-col gap-hair">
                            <Button
                                testID="kitchen-order-desk-sale-submit"
                                size="md"
                                block
                                label={actionLabel}
                                loading={placing}
                                disabled={!placeable || placing}
                                onPress={onPlace}
                            />
                            {/* What is still missing, said once, under the button it is holding shut. */}
                            {shortfall === null || shortfall === 'items' ? null : (
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    align="center"
                                    testID="kitchen-order-desk-sale-shortfall"
                                >
                                    {t(SHORTFALL_KEYS[shortfall])}
                                </Text>
                            )}
                        </View>
                    )}
                </View>
            </FormSection>
        </View>
    );
}

/**
 * The quote's totals.
 *
 * Null and zero are different facts: zero is a fee somebody decided on — a free-delivery zone — and
 * a counter sale has no fee at all. Printing "Delivery: 0.00" on a walk-in would be inventing a line
 * the order does not have.
 *
 * The subtotal is the food alone and the total adds the fee, so the subtotal is drawn only when
 * there is a fee to add: without one the two rows say the same number twice.
 *
 * The order-level refusals — no customer, no address, a slot the zone does not offer — are about
 * how the order leaves, so they are said only once that has been chosen. On the menu they were a
 * sentence about a question the page had not asked yet, and Back left them there.
 */
function Totals({
    quote,
    quoteFailure,
    money,
    showOrderRefusals,
    refusalText,
}: {
    readonly quote: OrderDeskQuote | null;
    /** Why the total could not be worked out — said under its "—". */
    readonly quoteFailure: string | null;
    readonly money: (amount: number, currency: OrderDeskQuote['currencyCode']) => string;
    readonly showOrderRefusals: boolean;
    readonly refusalText: (refusal: Refusal) => string;
}) {
    const { t } = useTranslation();

    const row = (label: string, value: string, testID: string, strong = false) => (
        <View className="flex-row items-baseline justify-between gap-tight">
            <Text variant={strong ? 'label' : 'caption'} tone={strong ? 'primary' : 'secondary'}>
                {label}
            </Text>
            <Text variant="mono" tone={strong ? 'brand' : 'secondary'} testID={testID}>
                {value}
            </Text>
        </View>
    );

    if (quote === null) {
        const dash = row(
            t('kitchen:desk.sale.total'),
            EM_DASH,
            'kitchen-order-desk-sale-total',
            true,
        );
        return quoteFailure === null ? (
            dash
        ) : (
            <View className="flex-col gap-hair">
                {dash}
                <Text
                    variant="caption"
                    tone="danger"
                    role="alert"
                    testID="kitchen-order-desk-sale-quote-error"
                >
                    {t('kitchen:desk.sale.quoteErrorTitle')}
                </Text>
                <Text variant="caption" tone="secondary">
                    {quoteFailure}
                </Text>
            </View>
        );
    }

    return (
        <View testID="kitchen-order-desk-sale-totals" className="flex-col gap-hair">
            {quote.deliveryFeeMinor === null ? null : (
                <>
                    {row(
                        t('kitchen:desk.sale.subtotal'),
                        money(quote.subtotalMinor, quote.currencyCode),
                        'kitchen-order-desk-sale-subtotal',
                    )}
                    {row(
                        t('kitchen:desk.sale.deliveryFee'),
                        money(quote.deliveryFeeMinor, quote.currencyCode),
                        'kitchen-order-desk-sale-fee',
                    )}
                </>
            )}
            {row(
                t('kitchen:desk.sale.total'),
                money(quote.totalMinor, quote.currencyCode),
                'kitchen-order-desk-sale-total',
                true,
            )}
            {(showOrderRefusals ? quote.refusals : []).map((refusal) => (
                <Text
                    key={refusal.reason}
                    variant="caption"
                    tone="warning"
                    testID={`kitchen-order-desk-sale-order-refusal-${refusal.reason}`}
                >
                    {refusalText(refusal)}
                </Text>
            ))}
        </View>
    );
}

/**
 * The ways this kind of sale may be paid, as two halves of one row — `paymentMethodsFor`'s list, so
 * the ticket can never offer a walk-in cash on delivery.
 */
function PaymentMethods({
    type,
    value,
    onChange,
}: {
    readonly type: OrderDeskFulfilmentType;
    readonly value: KitchenOrderPaymentMethod;
    readonly onChange: (method: KitchenOrderPaymentMethod) => void;
}) {
    const { t } = useTranslation();

    return (
        <View
            testID="kitchen-order-desk-sale-method"
            role="radiogroup"
            aria-label={t('kitchen:desk.sale.methodLabel')}
            className="flex-row gap-tight"
        >
            {paymentMethodsFor(type).map((candidate) => {
                const selected = value === candidate;
                return (
                    // eslint-disable-next-line no-restricted-syntax -- each method is half of the row.
                    <View key={candidate} className="min-w-0 flex-1">
                        <Pressable
                            testID={`kitchen-order-desk-sale-method-${candidate}`}
                            role="radio"
                            accessibilityRole="radio"
                            aria-checked={selected}
                            accessibilityState={{ checked: selected }}
                            onPress={() => {
                                onChange(candidate);
                            }}
                            className={
                                selected
                                    ? 'h-control-md flex-row items-center justify-center gap-hair rounded-sm border border-surface-brand bg-surface-brand-subtle px-control-sm'
                                    : 'h-control-md flex-row items-center justify-center gap-hair rounded-sm border border-stroke bg-surface-raised px-control-sm web:hover:border-surface-brand'
                            }
                        >
                            {selected ? (
                                <Icon
                                    name="check"
                                    size="sm"
                                    className="text-content-on-brand-subtle"
                                />
                            ) : null}
                            <Text variant="label" numberOfLines={1}>
                                {t(kitchenOrderPaymentMethodKey(candidate))}
                            </Text>
                        </Pressable>
                    </View>
                );
            })}
        </View>
    );
}
