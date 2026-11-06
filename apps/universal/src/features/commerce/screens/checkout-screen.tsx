import {
    FAILURE_MESSAGE_KEYS,
    Icon,
    ShellDock,
    cx,
    useBreakpoint,
} from '@healthy360/design-system';
import type {
    Cart,
    CheckoutPreview,
    CustomerAddress,
    PlacedOrder,
} from '@healthy360/api-client/contracts';
import { OrderId } from '@healthy360/domain-types';
import type { MealId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { useAccountChecklistQuery, useAddressesQuery } from '../../../data/account-hooks.ts';
import { useMealQuery } from '../../../data/catalogue-hooks.ts';
import {
    toFailure,
    useCartQuery,
    useCheckoutPreviewQuery,
    useMyOrderQuery,
    usePlaceOrderMutation,
} from '../../../data/commerce-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { queryKeys } from '../../../data/query-keys.ts';
import { withReturnTo } from '../../../navigation/return-to.ts';
import { usePreviousEntry } from '../../../navigation/use-return-to.ts';
import { usePrototypeAction } from '../../../prototype/index.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { BackPill } from '../../../ui/back-pill.tsx';
import { ShopPhoneTopBar } from '../../../ui/shop-phone-bar.tsx';
import { ShopStateButton } from '../../../ui/shop-state.tsx';
import { ShopDialog, ShopDialogButton, ShopDialogSubject } from '../../../ui/shop-dialog.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { AccountSetupPanel, stepForRequirement } from '../../account/account-setup-steps.tsx';
import type { AccountSetupStep } from '../../account/account-setup-steps.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import {
    CHECKOUT_PATH,
    checkoutHref,
    isIsoDate,
    LATEST_PLACED,
    placedOrders,
    readCheckoutDraft,
} from '../checkout-draft.ts';
import { SummaryRow } from '../checkout-frame.tsx';
import { addDays, earliestStartDate } from '../dates.ts';
import { CURRENT_DELIVERY_CHOICE, deliveryChoices } from '../delivery-choice.ts';
import {
    defaultSlotCode,
    deliverySlotByCode,
    deliverySlotsForKitchen,
    offeredSlots,
} from '../delivery.ts';
import { useAllergenNames } from '../my-allergens.tsx';
import {
    ALLERGEN_CONFLICT_WARNING,
    displayableWarnings,
    isCriticalWarning,
    warningMessageKey,
} from '../warnings.ts';

/**
 * `/customer/checkout` — one-off order checkout against a saved address, as the accepted Checkout
 * board draws it: "Basket" back, "Checkout" and the three-step progress beside it (Delivery · Payment
 * · Confirmation), the step's card, and beside it the order summary on the canopy — the dishes, the
 * price, and where, when and how it is paid.
 *
 * Placement requires `addressId` (D-084): delivery zone and fee resolve from the address book, not
 * a typed street line. Payment is cash on delivery — never card details in the app.
 *
 * ## The delivery step is choices, not a form
 *
 * Placement takes a saved address *identifier*, a window and a date, and nothing else. So the step is
 * the board's tiles: how it reaches you, the saved addresses (the default marked, "Add address" beside
 * them), six delivery dates from the earliest the kitchen can make, and the kitchen's windows offered
 * at that address. Name and phone are not drawn: the order carries neither.
 *
 * ## Delivery or pickup
 *
 * Both cards are drawn. Delivery is the real one and is chosen. `PlaceOrderRequest` has no
 * fulfilment mode, so Pickup is the prototype notice when the kitchen says it offers pickup at all,
 * and disabled — "Not offered by this kitchen" — when it does not.
 *
 * ## The payment step lists one method
 *
 * The design's three radio rows are a person's *saved instruments* — a Visa ending 4412, Apple Pay,
 * a corporate card. Nobody here has one: the contract is deliberately payment-free, and the order
 * is paid in cash at the door. So the card draws the design's radio list with the one true row in
 * it, chosen. A second, prototype "card" row was considered and rejected: it would put a dead end
 * directly above the button that places the order, and drawing an instrument nobody saved is the
 * fabrication the rest of the screen is built to avoid.
 *
 * ## Nothing here lives in component memory
 *
 * Address, date, window, step and the placed order are all in the URL (`../checkout-draft.ts`).
 * The customer area is one `<Slot/>`, so a detour to add an address unmounts this screen; with the
 * choices in the query, it comes back exactly as it was left, and so does a refresh.
 */

function formatSavedAddress(address: CustomerAddress): string {
    const parts = [address.label, address.line1, address.areaName].filter(
        (part) => part.trim() !== '',
    );
    return parts.join(' · ');
}

/** The street line as the driver reads it: line one, line two, building and floor. */
function streetOf(address: CustomerAddress | null, separator: string): string {
    if (address === null) return '';
    return [address.line1, address.line2, address.building, address.floor]
        .filter((part): part is string => part !== null && part.trim() !== '')
        .join(separator);
}

export function CheckoutScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const queryClient = useQueryClient();
    const formatter = useFormatter();
    const { locale } = useLocale();
    const runPrototype = usePrototypeAction();
    const { atLeast } = useBreakpoint();
    const draft = readCheckoutDraft(useLocalSearchParams());
    const previous = usePreviousEntry();
    const channelCode = draft.channel;

    const cart = useCartQuery(true, channelCode);
    const basket: Cart | undefined = cart.data;
    const addresses = useAddressesQuery();
    const checklist = useAccountChecklistQuery();
    const placeOrder = usePlaceOrderMutation(channelCode);
    const latestPlaced = placedOrders.useDraft(LATEST_PLACED);

    const placedId = draft.placed === undefined ? null : OrderId.safeParse(draft.placed);
    const placedOrder = useMyOrderQuery(placedId);

    const kitchenId = basket?.items[0]?.kitchenId ?? null;
    const kitchen = useKitchenQuery(kitchenId);
    const deliverySlots = deliverySlotsForKitchen(kitchen.data);
    const kitchenOffersPickup = kitchen.data?.channels.pickup === true;

    const [showErrors, setShowErrors] = useState(false);

    const addressList = addresses.data ?? [];
    /*
     * Every choice comes from the URL (`../checkout-draft.ts`) and is checked against live data
     * before it is believed; anything missing or no longer valid falls back to what the screen
     * would have picked on its own. So the address is the one in the URL when it is still in the
     * book, else the default address, else the only one there is (HA-22) — somebody with one
     * address is never made to open a list of one to pick it.
     */
    const addressId =
        (draft.address !== undefined && addressList.some((entry) => entry.id === draft.address)
            ? draft.address
            : null) ??
        addressList.find((entry) => entry.isDefault)?.id ??
        (addressList.length === 1 ? (addressList[0]?.id ?? null) : null);
    const selectedAddress = addressList.find((entry) => entry.id === addressId) ?? null;

    // What the shop's Deliver to picked for this visit, when the URL has no choice of its own.
    const shopChoice = deliveryChoices.useDraft(CURRENT_DELIVERY_CHOICE);
    const wantedDate = draft.date ?? shopChoice?.date;
    const wantedSlot = draft.slot ?? shopChoice?.slot;

    const earliestDate = earliestStartDate();
    const deliveryDate =
        isIsoDate(wantedDate) && wantedDate >= earliestDate ? wantedDate : earliestDate;

    // A plain object: the query hashes its key, so a new one each render asks for nothing new.
    const previewRequest =
        basket === undefined || basket.items.length === 0
            ? null
            : {
                  cartId: basket.id,
                  ...(addressId === null ? {} : { addressId }),
                  deliveryDate,
              };

    const preview = useCheckoutPreviewQuery(previewRequest);
    const quotation: CheckoutPreview | undefined = preview.data;

    /*
     * Meals that cross the person's allergies, by the server's rule. They may still be ordered —
     * often they are for somebody else — so the order is never blocked: the page says so, and Place
     * order asks once more before sending. The server checks again at placement, against the
     * allergies as they stand then, and refuses until it hears the person was asked.
     */
    const allergenConflicts = quotation?.allergenConflicts ?? [];
    const allergenNames = useAllergenNames();
    const clashingMeals = (basket?.items ?? []).flatMap((item) => {
        const conflict = allergenConflicts.find((candidate) => candidate.mealId === item.mealId);
        if (conflict === undefined) return [];
        return [
            conflict.allergenCodes.length === 0
                ? item.name
                : t('commerce:myAllergens.mealWithAllergens', {
                      meal: item.name,
                      allergens: allergenNames(conflict.allergenCodes),
                  }),
        ];
    });
    const clashingList = clashingMeals.join(t('marketplace:common.listSeparator'));
    /** Basket + checkout, pin 4: the tag under a line whose dish crosses the allergy list. */
    const clashTag = (mealId: MealId): string | undefined => {
        const conflict = allergenConflicts.find((candidate) => candidate.mealId === mealId);
        if (conflict === undefined) return undefined;
        return conflict.allergenCodes.length === 0
            ? t('commerce:myAllergens.unassessedTag')
            : t('commerce:myAllergens.lineTag', {
                  allergens: allergenNames(conflict.allergenCodes),
              });
    };
    const [allergenConfirmOpen, setAllergenConfirmOpen] = useState(false);

    /*
     * Only the slots the address's zone offers: placement refuses any other (`window_not_offered`).
     * `null` codes — no address yet, or no serving zone — filter nothing. A choice the zone does not
     * offer falls back to the default over what it does, and a zone offering none says so.
     */
    const slotOptions = offeredSlots(deliverySlots, quotation?.offeredWindowCodes ?? null);
    const slotCode =
        wantedSlot !== undefined && slotOptions.some((slot) => slot.code === wantedSlot)
            ? wantedSlot
            : defaultSlotCode(slotOptions);
    const placeFailure = toFailure(placeOrder.error);

    /*
     * The payment step is `?step=payment`, honoured only while the delivery details it commits to
     * are exactly the ones in its URL and all still valid. The delivery step may fill a gap with a
     * default; the payment step may not — it is the page that says "delivering to … on …" above
     * Place order, so a Back (or a link) that lands on it after the address was removed, the window
     * withdrawn or the date overtaken must not quietly swap in a different one and offer to place
     * that. Such an entry is put back on the delivery step, with the problem marked.
     *
     * Only once the data has *settled*, and the address book counts as settled only when it is not
     * fetching at all: coming back from adding an address, the book is refetched on remount, and
     * judging `?address=` against the copy from before the detour would throw the person off the
     * step they were on.
     */
    const committedToUrl =
        selectedAddress !== null &&
        slotCode !== null &&
        draft.address === addressId &&
        draft.date === deliveryDate &&
        draft.slot === slotCode;
    const onPayment = draft.step === 'payment' && committedToUrl;
    const settled =
        basket !== undefined && !addresses.isFetching && !kitchen.isLoading && !preview.isFetching;
    const strandedOnPayment = draft.step === 'payment' && !committedToUrl && settled;
    useEffect(() => {
        if (!strandedOnPayment) return;
        router.setParams({ step: undefined } as never);
    }, [router, strandedOnPayment]);

    /*
     * A refusal names *every* reason it was refused for, and the checkout lists them — one sentence
     * saying the order could not be placed sends somebody back to a basket with nothing to change.
     * Reasons the catalogue has no copy for still appear, as the server's own code.
     */
    const refusalReasons =
        placeFailure?.code === 'order.placement_refused' ? placeFailure.reasons : [];

    /*
     * Account setup is never "go to the account page and guess", and it is no longer a surprise at
     * the end. The account checklist is read up front, so the steps a new account still has to do
     * are listed on the first step, each a row that opens the screen that does it and comes back
     * here (`returnTo`) with every choice intact. Place order waits until the list is empty.
     *
     * The server's refusal stays as the backstop for a race — a step that became outstanding after
     * the checklist was read: one `account_not_ready` per requirement, naming it in `outstanding`
     * (and, for an address, whether one exists outside the served areas). Every other reason is
     * about the order itself and stays in the refusal's list.
     */
    const setupSteps: AccountSetupStep[] = [];
    for (const item of checklist.data?.items ?? []) {
        if (!item.required || item.complete) continue;
        setupSteps.push({
            step: item.step,
            blockedReason: item.blockedReason,
            ...(item.step === 'add_address' ? { hasAddress: addressList.length > 0 } : {}),
        });
    }
    let refusedForSetup = false;
    for (const entry of refusalReasons) {
        if (entry.reason !== 'account_not_ready') continue;
        const step = stepForRequirement(entry.context['outstanding']);
        if (step === null) continue;
        refusedForSetup = true;
        if (setupSteps.some((existing) => existing.step === step)) continue;
        setupSteps.push({ step, hasAddress: entry.context['has_address'] === true });
    }
    // An `account_not_ready` this build cannot name a step for stays in the list, so it is never lost.
    const orderReasons = refusalReasons.filter(
        (entry) =>
            entry.reason !== 'account_not_ready' ||
            stepForRequirement(entry.context['outstanding']) === null,
    );
    /*
     * `account_not_active` comes only once the checklist is clean — a suspended or closed account —
     * so there is no step to do; the account page is where its state is explained. So is a setup
     * requirement with no step to name.
     */
    const accountInactive = orderReasons.some(
        (entry) => entry.reason === 'account_not_active' || entry.reason === 'account_not_ready',
    );

    /*
     * Where a detour comes back to: this page as it stands, with the defaults the screen derived
     * written out, so returning restores exactly what was on screen.
     */
    const here = checkoutHref({
        channel: channelCode,
        address: addressId ?? undefined,
        date: deliveryDate,
        slot: slotCode ?? undefined,
        step: onPayment ? 'payment' : undefined,
    });
    const openDetour = (href: string) => {
        router.push(withReturnTo(href, here) as never);
    };

    const slotName = (code: string) =>
        deliverySlotByCode(code, kitchen.data)?.label ??
        // A kitchen may publish a window code this catalogue has never heard of, and the code
        // itself reads better than `commerce:slots.late_evening`.
        t(`commerce:slots.${code}`, { defaultValue: code });

    const slotSentence = (slotLabel: string, date: string) =>
        t('commerce:checkout.committedSlot', {
            slot: slotLabel,
            date: formatter.formatDate(date, { dateStyle: 'medium' }),
        });

    /*
     * Placed, and the confirmation not drawn yet: the basket is empty, and that is not an empty
     * checkout. Once the confirmation has been drawn the note says so, and Back to the now-empty
     * checkout shows the empty state with "Track this order".
     */
    const placing =
        placeOrder.isPending ||
        (placeOrder.isSuccess &&
            latestPlaced?.orderId === placeOrder.data.id &&
            latestPlaced.printed !== true);
    const seenPlaced = placedId !== null && latestPlaced?.orderId === placedId;
    const seenAlready = latestPlaced?.printed === true;
    useEffect(() => {
        if (!seenPlaced || seenAlready || latestPlaced === null) return;
        placedOrders.write(LATEST_PLACED, { ...latestPlaced, printed: true });
    }, [latestPlaced, seenAlready, seenPlaced]);

    /*
     * The confirmation is `?placed={order}`, read back from the order itself, so a refresh, or Back
     * from "Track this order", shows it again rather than an empty checkout.
     */
    if (placedId !== null) {
        const order = placedOrder.data;
        const note = latestPlaced?.orderId === placedId ? latestPlaced : null;
        const orderSlot =
            order === undefined
                ? ''
                : (note?.slotLabel ??
                  (locale.toLowerCase().startsWith('ar')
                      ? order.slotNames?.ar
                      : order.slotNames?.en) ??
                  order.slotNames?.en ??
                  slotName(order.slotCode));
        return (
            <View testID="checkout-success-screen" className="flex-col pb-12">
                <CheckoutTop current={2} />
                <View className="mt-[22px]">
                    <QueryStates
                        query={placedOrder}
                        isEmpty={false}
                        treatFailuresAsEmpty={['resource.not_found']}
                        emptyTitle={t('account:orders.notFoundTitle')}
                        emptyBody={t('account:orders.notFoundBody')}
                        skeletonCount={2}
                        testID="checkout-placed"
                    >
                        {order === undefined ? null : (
                            <OrderPlaced
                                order={order}
                                kitchenName={note?.kitchenName ?? null}
                                arriving={slotSentence(orderSlot, order.deliveryDate)}
                                onTrack={() => {
                                    router.push(`/customer/orders/${order.id}` as never);
                                }}
                                onKeepShopping={() => {
                                    router.push('/meals' as never);
                                }}
                            />
                        )}
                    </QueryStates>
                </View>
            </View>
        );
    }

    const onReview = () => {
        setShowErrors(true);
        if (selectedAddress === null || slotCode === null) return;
        // A step of its own in history, so Back from Payment returns to Delivery.
        router.push(
            checkoutHref({
                channel: channelCode,
                address: selectedAddress.id,
                date: deliveryDate,
                slot: slotCode,
                step: 'payment',
            }) as never,
        );
    };

    const onBackToDelivery = () => {
        // Back when the delivery step is the entry underneath; otherwise (a refresh, a link) the
        // step is taken off this entry, so the in-card Back never leaves the checkout.
        if (
            previous !== null &&
            previous.pathname === CHECKOUT_PATH &&
            previous.params['step'] !== 'payment'
        ) {
            router.back();
        } else {
            router.setParams({ step: undefined } as never);
        }
    };

    const committed =
        onPayment && selectedAddress !== null && slotCode !== null
            ? {
                  addressId: selectedAddress.id,
                  addressLabel: formatSavedAddress(selectedAddress),
                  slotCode,
                  slotLabel: slotName(slotCode),
                  kitchenName: kitchen.data?.name ?? null,
                  deliveryDate,
              }
            : null;

    const onPlace = (allergensConfirmed = false) => {
        if (basket === undefined || committed === null) return;
        if (allergenConflicts.length > 0 && !allergensConfirmed) {
            setAllergenConfirmOpen(true);
            return;
        }
        placeOrder.mutate(
            {
                cartId: basket.id,
                addressId: committed.addressId,
                slotCode: committed.slotCode,
                deliveryDate: committed.deliveryDate,
                ...(allergenConflicts.length > 0 ? { acknowledgeAllergenConflicts: true } : {}),
            },
            {
                onSuccess: (order) => {
                    placedOrders.write(LATEST_PLACED, {
                        orderId: order.id,
                        kitchenName: committed.kitchenName,
                        slotLabel: committed.slotLabel,
                    });
                    // Replaces the payment step: Back from the confirmation is not a second chance
                    // to place the same order.
                    router.replace(
                        checkoutHref({ channel: channelCode, placed: order.id }) as never,
                    );
                },
                onError: () => {
                    // A setup refusal means the checklist read earlier is out of date.
                    void queryClient.invalidateQueries({
                        queryKey: queryKeys.account.checklist(),
                    });
                    // So does the preview, when the refusal was an allergy changed since it ran.
                    void queryClient.invalidateQueries({
                        queryKey: ['commerce', 'checkout', 'preview'],
                    });
                },
            },
        );
    };

    /* ── step one: delivery details ─────────────────────────────────────────────────────────── */

    const dateTiles = Array.from({ length: DATE_TILES }, (_, index) =>
        addDays(earliestDate, index),
    ).filter((date): date is string => date !== null);
    const noon = (date: string) => `${date}T12:00:00Z`;

    const deliveryStep = (
        <View className="flex-col" testID="checkout-delivery-step">
            <PanelTitle title={t('commerce:checkout.deliveryTitle')} />

            <PanelLabel first>{t('commerce:checkout.modeLabel')}</PanelLabel>
            <View
                testID="checkout-mode"
                role="radiogroup"
                accessibilityRole="radiogroup"
                aria-label={t('commerce:checkout.modeLabel')}
                accessibilityLabel={t('commerce:checkout.modeLabel')}
                className="flex-row flex-wrap gap-2.5"
            >
                <ChoiceTile
                    testID="checkout-mode-delivery"
                    icon="truck"
                    title={t('commerce:checkout.modeDelivery')}
                    sub={
                        quotation?.deliveryFee === null || quotation === undefined
                            ? t('commerce:checkout.modeDeliverySub')
                            : t('commerce:checkout.modeDeliveryFee', {
                                  fee: formatMoney(formatter, quotation.deliveryFee),
                              })
                    }
                    chosen
                />
                <ChoiceTile
                    testID="checkout-mode-pickup"
                    icon="store"
                    title={t('commerce:checkout.modePickup')}
                    sub={
                        kitchenOffersPickup
                            ? t('commerce:checkout.modePickupSub')
                            : t('commerce:checkout.modePickupUnavailable')
                    }
                    chosen={false}
                    disabled={!kitchenOffersPickup}
                    accessibilityHint={t('marketplace:prototype.notBuilt')}
                    onPress={() => {
                        runPrototype({ contract: 'PlaceOrderRequest.fulfilment = "pickup"' });
                    }}
                />
            </View>

            <PanelLabel>{t('commerce:checkout.savedAddress')}</PanelLabel>
            <View testID="checkout-address">
                <QueryStates
                    query={addresses}
                    isEmpty={false}
                    emptyTitle={t('commerce:checkout.noAddressTitle')}
                    skeleton="rows"
                    skeletonCount={1}
                    testID="checkout-addresses"
                >
                    {/* Basket + checkout, pin 2: one dashed tile with its action. */}
                    {addressList.length === 0 ? (
                        <DashedTile
                            testID="checkout-addresses-empty"
                            icon="mapPin"
                            title={t('commerce:checkout.noAddressTitle')}
                            body={t('commerce:checkout.noAddressBody')}
                            action={
                                <Pressable
                                    testID="checkout-add-address"
                                    role="button"
                                    accessibilityRole="button"
                                    onPress={() => {
                                        openDetour('/customer/account/addresses/new');
                                    }}
                                    className="h-11 flex-row items-center gap-1.5 rounded-full bg-surface-brand px-[18px] hover:opacity-90"
                                >
                                    <Icon name="plus" size="sm" className="text-content-on-brand" />
                                    <RNText className="text-sm font-bold text-content-on-brand">
                                        {t('commerce:checkout.addAddressAction')}
                                    </RNText>
                                </Pressable>
                            }
                        />
                    ) : (
                        <View
                            testID="checkout-address-picker"
                            role="radiogroup"
                            aria-label={t('commerce:checkout.addressTitle')}
                            className="flex-row flex-wrap gap-2.5"
                        >
                            {addressList.map((entry) => (
                                <ChoiceTile
                                    key={entry.id}
                                    testID={`checkout-address-${entry.id}`}
                                    icon="mapPin"
                                    title={entry.label.trim() === '' ? entry.areaName : entry.label}
                                    badge={
                                        entry.isDefault
                                            ? t('commerce:checkout.defaultAddress')
                                            : undefined
                                    }
                                    sub={[
                                        entry.areaName,
                                        streetOf(entry, t('commerce:common.listSeparator')),
                                    ]
                                        .filter((part) => part.trim() !== '')
                                        .join(' · ')}
                                    chosen={entry.id === addressId}
                                    invalid={showErrors && addressId === null}
                                    onPress={() => {
                                        router.setParams({ address: entry.id } as never);
                                    }}
                                />
                            ))}
                            <Pressable
                                testID="checkout-manage-addresses"
                                role="button"
                                accessibilityRole="button"
                                onPress={() => {
                                    openDetour('/customer/account/addresses/new');
                                }}
                                className="min-h-16 min-w-[220px] flex-1 flex-row items-center justify-center gap-2 rounded-[18px] border-[1.5px] border-dashed border-stroke hover:border-surface-brand hover:bg-surface-brand-subtle"
                            >
                                <Icon
                                    name="plus"
                                    size="sm"
                                    className="text-content-on-brand-subtle"
                                />
                                <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                                    {t('commerce:checkout.addAddressShort')}
                                </RNText>
                            </Pressable>
                        </View>
                    )}
                </QueryStates>
            </View>

            <PanelLabel>{t('commerce:checkout.dateLabel')}</PanelLabel>
            <View
                testID="checkout-date"
                role="radiogroup"
                aria-label={t('commerce:checkout.dateLabel')}
                className="flex-row flex-wrap gap-2"
            >
                {dateTiles.map((date, index) => {
                    const on = date === deliveryDate;
                    return (
                        <Pressable
                            key={date}
                            testID={`checkout-date-${date}`}
                            role="radio"
                            aria-checked={on}
                            accessibilityState={{ checked: on, selected: on }}
                            accessibilityLabel={formatter.formatDate(noon(date), {
                                dateStyle: 'full',
                            })}
                            onPress={() => {
                                router.setParams({ date } as never);
                            }}
                            className={cx(
                                'h-[72px] w-[68px] items-center justify-center gap-0.5 rounded-2xl border-[1.5px] transition duration-normal ease-standard hover:-translate-y-0.5',
                                on
                                    ? 'border-surface-brand bg-surface-brand'
                                    : 'border-stroke bg-surface-raised hover:border-surface-brand',
                            )}
                        >
                            <RNText
                                className={cx(
                                    'text-xs font-semibold uppercase tracking-wide',
                                    on ? 'text-content-on-brand' : 'text-content-secondary',
                                )}
                            >
                                {index === 0
                                    ? t('commerce:checkout.tomorrowShort')
                                    : formatter.formatDate(noon(date), { weekday: 'short' })}
                            </RNText>
                            <RNText
                                className={cx(
                                    'font-display text-xl font-bold tabular-nums',
                                    on ? 'text-content-on-brand' : 'text-content-primary',
                                )}
                            >
                                {formatter.formatDate(noon(date), { day: 'numeric' })}
                            </RNText>
                        </Pressable>
                    );
                })}
            </View>

            <PanelLabel>{t('commerce:checkout.slotTitle')}</PanelLabel>
            <View testID="checkout-slot">
                {addressId === null ? (
                    // No address yet: the windows wait for one, drawn as faded empty places.
                    <View
                        testID="checkout-slot-waiting"
                        aria-hidden
                        className="flex-row gap-2 opacity-45"
                    >
                        {[0, 1, 2, 3].map((index) => (
                            <View
                                key={index}
                                className="h-[60px] flex-1 rounded-2xl border-[1.5px] border-dashed border-stroke"
                            />
                        ))}
                    </View>
                ) : slotCode === null ? (
                    // Basket + checkout, pin 3: what is wrong and what to do, in the windows' place.
                    <DashedTile
                        testID="checkout-slot-none"
                        tone="warning"
                        role="alert"
                        icon="clock"
                        title={t('commerce:checkout.noWindowTitle')}
                        body={t('commerce:checkout.noSlotsOffered')}
                    />
                ) : (
                    <View
                        testID="checkout-slot-picker"
                        role="radiogroup"
                        aria-label={t('commerce:checkout.slotTitle')}
                        className="flex-row flex-wrap gap-2"
                    >
                        {slotOptions.map((slot) => {
                            const on = slot.code === slotCode;
                            return (
                                <Pressable
                                    key={slot.code}
                                    testID={`checkout-slot-${slot.code}`}
                                    role="radio"
                                    aria-checked={on}
                                    accessibilityState={{ checked: on, selected: on }}
                                    onPress={() => {
                                        router.setParams({ slot: slot.code } as never);
                                    }}
                                    className={cx(
                                        'h-[60px] min-w-[120px] flex-1 items-center justify-center gap-0.5 rounded-2xl border-[1.5px]',
                                        on
                                            ? 'border-surface-brand bg-surface-brand-subtle'
                                            : 'border-stroke bg-surface-raised hover:border-surface-brand',
                                    )}
                                >
                                    <RNText
                                        className={cx(
                                            'text-sm font-bold',
                                            on
                                                ? 'text-content-on-brand-subtle'
                                                : 'text-content-primary',
                                        )}
                                    >
                                        {slotName(slot.code)}
                                    </RNText>
                                    <RNText
                                        className={cx(
                                            'text-xs font-medium tabular-nums',
                                            on
                                                ? 'text-content-on-brand-subtle'
                                                : 'text-content-secondary',
                                        )}
                                    >
                                        {`${slot.startsAt} – ${slot.endsAt}`}
                                    </RNText>
                                </Pressable>
                            );
                        })}
                    </View>
                )}
            </View>

            <PanelActions>
                <ArrowAction
                    testID="checkout-review"
                    label={t('commerce:checkout.review')}
                    // No saved address, nothing to continue with — the empty state above says what to
                    // do, and the disabled button says it again to somebody who cannot see it.
                    disabled={addresses.isSuccess && addressList.length === 0}
                    {...(addresses.isSuccess && addressList.length === 0
                        ? { accessibilityHint: t('commerce:checkout.noAddressTitle') }
                        : {})}
                    onPress={onReview}
                />
            </PanelActions>
        </View>
    );

    /* ── step two: payment ──────────────────────────────────────────────────────────────────── */

    const whenLine = (date: string, slotLabel: string, slot: string) => {
        const window = deliverySlotByCode(slot, kitchen.data);
        return [
            formatter.formatDate(noon(date), { weekday: 'short', day: 'numeric', month: 'short' }),
            window === null ? slotLabel : `${slotLabel} ${window.startsAt} – ${window.endsAt}`,
        ].join(' · ');
    };

    const paymentStep =
        committed === null ? null : (
            <View className="flex-col" testID="checkout-payment-step">
                <PanelTitle title={t('commerce:checkout.paymentTitle')} />

                <PanelLabel first>{t('commerce:checkout.payWith')}</PanelLabel>
                <View
                    testID="checkout-payment-methods"
                    role="radiogroup"
                    accessibilityRole="radiogroup"
                    aria-label={t('commerce:checkout.paymentTitle')}
                    accessibilityLabel={t('commerce:checkout.paymentTitle')}
                >
                    <View
                        testID="checkout-payment-cod"
                        role="radio"
                        aria-checked
                        accessibilityState={{ checked: true }}
                        className="flex-row items-center gap-3.5 rounded-[18px] border-[1.5px] border-surface-brand bg-surface-brand-subtle p-4"
                    >
                        <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-surface-raised">
                            <Icon name="store" size="md" className="text-content-on-brand-subtle" />
                        </View>
                        <View className="min-w-0 flex-1">
                            <RNText className="text-base font-bold text-content-on-brand-subtle text-start">
                                {t('commerce:checkout.paymentCod')}
                            </RNText>
                            <RNText className="text-sm font-medium text-content-on-brand-subtle opacity-85 text-start">
                                {t('commerce:checkout.paymentCodMeta')}
                            </RNText>
                        </View>
                        <RadioDot on />
                    </View>
                </View>

                <View className="mt-3.5 flex-row flex-wrap gap-2.5">
                    <ReviewCell
                        testID="checkout-committed-address"
                        label={t('commerce:checkout.deliveringToLabel')}
                        value={committed.addressLabel}
                        onChange={onBackToDelivery}
                    />
                    <ReviewCell
                        testID="checkout-committed-slot"
                        label={t('commerce:checkout.whenLabel')}
                        value={whenLine(
                            committed.deliveryDate,
                            committed.slotLabel,
                            committed.slotCode,
                        )}
                        onChange={onBackToDelivery}
                    />
                </View>

                {placeFailure === null ||
                (setupSteps.length > 0 && orderReasons.length === 0) ? null : (
                    <View className="mt-5">
                        {/* Basket + checkout, pin 6: the title, each reason as a line, its one action. */}
                        <View
                            testID="checkout-place-error"
                            role="alert"
                            className="overflow-hidden rounded-[18px] border border-danger-border bg-danger-subtle"
                        >
                            <View className="flex-row items-center gap-2.5 px-4 pb-1.5 pt-3.5">
                                <View className="h-8 w-8 items-center justify-center rounded-[10px] bg-danger-strong">
                                    <Icon
                                        name="close"
                                        size="sm"
                                        className="text-danger-on-strong"
                                    />
                                </View>
                                <RNText className="shrink text-base font-bold text-danger-on-subtle text-start">
                                    {t('commerce:checkout.placeFailedTitle')}
                                </RNText>
                            </View>
                            <View className="flex-col gap-1.5 pb-3 pe-4 ps-[58px] pt-1">
                                {orderReasons.length === 0 ? (
                                    <RNText className="text-sm leading-[18px] text-danger-on-subtle text-start">
                                        {t(
                                            FAILURE_MESSAGE_KEYS[placeFailure.code],
                                            // The server's own sentence only when this build has no
                                            // copy for the code — never in preference to it.
                                            { defaultValue: placeFailure.message },
                                        )}
                                    </RNText>
                                ) : (
                                    <View
                                        className="flex-col gap-1.5"
                                        testID="checkout-place-error-reasons"
                                    >
                                        {orderReasons.map((entry) => (
                                            <RNText
                                                key={entry.reason}
                                                testID={`checkout-place-error-reason-${entry.reason}`}
                                                className="text-sm leading-[18px] text-danger-on-subtle text-start"
                                            >
                                                {t(`errors:orderRefusal.${entry.reason}`, {
                                                    defaultValue: entry.reason,
                                                })}
                                            </RNText>
                                        ))}
                                    </View>
                                )}
                            </View>
                            <View className="flex-row flex-wrap items-center gap-2.5 border-t border-danger-border bg-surface-raised px-4 py-2.5">
                                {accountInactive ? (
                                    <Pressable
                                        testID="checkout-finish-setup"
                                        role="button"
                                        accessibilityRole="button"
                                        onPress={() => {
                                            openDetour('/customer/account');
                                        }}
                                        className="h-[38px] flex-row items-center gap-1.5 rounded-full bg-surface-inverse px-3.5 hover:opacity-90"
                                    >
                                        <RNText className="text-sm font-bold text-content-inverse">
                                            {t('commerce:checkout.finishSetup')}
                                        </RNText>
                                        <Icon
                                            name="chevronEnd"
                                            size="sm"
                                            className="text-content-inverse"
                                        />
                                    </Pressable>
                                ) : null}
                                <RNText className="text-xs text-content-secondary">
                                    {t('commerce:checkout.basketKept')}
                                </RNText>
                            </View>
                        </View>
                    </View>
                )}

                {/* Basket + checkout, pin 7: each dish that crosses the list, then Place order anyway. */}
                <ShopDialog
                    testID="checkout-allergen-confirm"
                    open={allergenConfirmOpen}
                    onClose={() => {
                        setAllergenConfirmOpen(false);
                    }}
                    tone="warning"
                    icon="alert"
                    title={t('commerce:myAllergens.confirmTitle')}
                    description={
                        clashingMeals.length === 0
                            ? t('commerce:warnings.checkout_allergen_conflict')
                            : t('commerce:myAllergens.checkoutBody', { meals: clashingList })
                    }
                    actions={
                        <>
                            <ShopDialogButton
                                testID="checkout-allergen-confirm-cancel"
                                label={t('common:action.cancel')}
                                onPress={() => {
                                    setAllergenConfirmOpen(false);
                                }}
                            />
                            <ShopDialogButton
                                testID="checkout-allergen-confirm-place"
                                kind="ink"
                                label={t('commerce:myAllergens.placeAnyway')}
                                onPress={() => {
                                    setAllergenConfirmOpen(false);
                                    onPlace(true);
                                }}
                            />
                        </>
                    }
                >
                    <View className="flex-col gap-2">
                        {(basket?.items ?? []).flatMap((item) => {
                            const conflict = allergenConflicts.find(
                                (candidate) => candidate.mealId === item.mealId,
                            );
                            if (conflict === undefined) return [];
                            return [
                                <ClashLine
                                    key={item.id}
                                    testID={`checkout-allergen-confirm-line-${item.id}`}
                                    name={item.name}
                                    mealId={item.mealId}
                                    meta={`${formatter.formatNumber(item.quantity)} × ${formatMoney(formatter, item.unitPrice)}`}
                                    allergens={conflict.allergenCodes.map((code) =>
                                        allergenNames([code]),
                                    )}
                                />,
                            ];
                        })}
                    </View>
                </ShopDialog>

                <PanelActions>
                    <Pressable
                        testID="checkout-edit"
                        role="button"
                        accessibilityRole="button"
                        onPress={onBackToDelivery}
                        className="h-[52px] flex-row items-center gap-2 rounded-2xl border border-stroke bg-surface-raised pe-[18px] ps-3 hover:bg-surface-brand-subtle"
                    >
                        <Icon name="chevronBackward" size="sm" className="text-content-primary" />
                        <RNText className="text-base font-semibold text-content-primary">
                            {t('commerce:checkout.back')}
                        </RNText>
                    </Pressable>
                    <ArrowAction
                        testID="checkout-place-order"
                        label={
                            quotation === undefined
                                ? t('commerce:checkout.placeOrder')
                                : t('commerce:checkout.placeOrderTotal', {
                                      total: formatMoney(formatter, quotation.total),
                                  })
                        }
                        accessibilityHint={
                            setupSteps.length > 0
                                ? t('commerce:checkout.placeOrderBlockedHint')
                                : t('commerce:checkout.placeOrderHint')
                        }
                        loading={placeOrder.isPending}
                        // No confirmed total, no placement; nor while account steps are left.
                        disabled={quotation === undefined || setupSteps.length > 0}
                        onPress={() => {
                            onPlace();
                        }}
                    />
                </PanelActions>
            </View>
        );

    /* ── the summary ────────────────────────────────────────────────────────────────────────── */

    const addressLine =
        selectedAddress === null
            ? null
            : [selectedAddress.label, selectedAddress.areaName]
                  .filter((part) => part.trim() !== '')
                  .join(' · ');
    const slotForSummary = slotCode === null ? null : slotName(slotCode);

    const summary =
        basket === undefined ? null : (
            <SummaryCard
                testID="checkout-summary"
                countTestID="checkout-summary-count"
                total={quotation === undefined ? null : formatMoney(formatter, quotation.total)}
                itemCount={basket.itemCount}
            >
                <View testID="checkout-items" className="flex-col">
                    {basket.items.map((item) => (
                        <MiniLine
                            key={item.id}
                            testID={`checkout-items-${item.id}`}
                            name={item.name}
                            mealId={item.mealId}
                            quantity={item.quantity}
                            unit={formatMoney(formatter, item.unitPrice)}
                            total={formatMoney(formatter, item.lineTotal)}
                            clash={clashTag(item.mealId)}
                        />
                    ))}
                </View>
                <QueryStates
                    query={preview}
                    isEmpty={false}
                    emptyTitle={t('commerce:cart.summaryEmpty')}
                    skeletonCount={1}
                    testID="checkout-preview"
                >
                    {quotation === undefined ? null : (
                        <View className="flex-col">
                            {/*
                             * What the total is made of, as the basket showed it (HA-22): a total that
                             * grew by the delivery fee with no line saying so read as an error.
                             */}
                            <View className="mt-1.5 flex-col gap-3 border-t border-stroke-subtle pt-3">
                                <SummaryRow
                                    testID="checkout-price-subtotal"
                                    label={t('commerce:cart.subtotal')}
                                    value={formatMoney(formatter, quotation.subtotal)}
                                />
                                {/* Unknown until an address is chosen; the warning below says so. */}
                                {quotation.deliveryFee === null ? null : (
                                    <SummaryRow
                                        testID="checkout-price-delivery"
                                        label={
                                            selectedAddress === null ||
                                            selectedAddress.areaName.trim() === ''
                                                ? t('commerce:cart.delivery')
                                                : t('commerce:cart.deliveryTo', {
                                                      area: selectedAddress.areaName,
                                                  })
                                        }
                                        value={formatMoney(formatter, quotation.deliveryFee)}
                                    />
                                )}
                            </View>
                            <View
                                testID="checkout-price-total"
                                className="mt-3 flex-row items-baseline justify-between border-t border-dashed border-stroke pt-3"
                            >
                                <RNText className="text-sm text-content-secondary">
                                    {t('commerce:cart.total')}
                                </RNText>
                                <RNText
                                    testID="checkout-price-total-amount"
                                    className="font-display text-2xl font-bold tabular-nums tracking-display text-content-primary"
                                >
                                    {formatMoney(formatter, quotation.total)}
                                </RNText>
                            </View>
                            {/* The allergen one is said beside Place order, which asks about it. */}
                            {/* Basket + checkout, pin 5: one title, one line each. The allergen
                                one is said on its dish and asked about at Place order. */}
                            {(() => {
                                const notes = displayableWarnings(quotation.warnings).filter(
                                    (code) => code !== ALLERGEN_CONFLICT_WARNING,
                                );
                                if (notes.length === 0) return null;
                                const critical = notes.some((code) => isCriticalWarning(code));
                                return (
                                    <View
                                        testID="checkout-warnings"
                                        role={critical ? 'alert' : 'note'}
                                        className="mt-3 rounded-2xl bg-warning-subtle px-3.5 py-3"
                                    >
                                        <View className="flex-row items-center gap-2">
                                            <Icon
                                                name="infoCircle"
                                                size="sm"
                                                className="text-warning-on-subtle"
                                            />
                                            <RNText className="text-sm font-bold text-warning-on-subtle">
                                                {t('commerce:warnings.title')}
                                            </RNText>
                                        </View>
                                        <View className="mt-2 flex-col gap-1.5">
                                            {notes.map((code) => (
                                                <View
                                                    key={code}
                                                    testID={`checkout-warning-${code.replace(/\./g, '-')}`}
                                                    className="flex-row gap-2"
                                                >
                                                    <View
                                                        className={cx(
                                                            'mt-1.5 h-1.5 w-1.5 rounded-full',
                                                            isCriticalWarning(code)
                                                                ? 'bg-danger-strong'
                                                                : 'bg-warning-strong',
                                                        )}
                                                    />
                                                    <RNText className="min-w-0 flex-1 text-sm leading-[18px] text-warning-on-subtle text-start">
                                                        {t(warningMessageKey(code), { code })}
                                                    </RNText>
                                                </View>
                                            ))}
                                        </View>
                                    </View>
                                );
                            })()}
                        </View>
                    )}
                </QueryStates>
                <DeliveryFacts
                    address={addressLine}
                    when={
                        slotCode === null || slotForSummary === null
                            ? null
                            : whenLine(deliveryDate, slotForSummary, slotCode)
                    }
                />
            </SummaryCard>
        );

    const wide = atLeast('lg');

    return (
        <View testID="checkout-screen" className="flex-col pb-12">
            <CheckoutTop
                current={committed === null ? 0 : 1}
                onBasket={() => {
                    router.push('/customer/cart' as never);
                }}
            />

            <View className="mt-[22px]">
                <QueryStates
                    query={cart}
                    // Placement empties the basket before the confirmation takes over: an order on
                    // its way is not an empty checkout.
                    isEmpty={basket !== undefined && basket.items.length === 0 && !placing}
                    emptyTitle={t('commerce:checkout.emptyTitle')}
                    emptyBody={t('commerce:checkout.emptyBody')}
                    // Basket + checkout, pin 11: the shop's empty card, with the way to the menu.
                    emptyIcon="shoppingBasket"
                    emptyActions={
                        <>
                            {/* Back from a confirmation lands here, on the now-empty basket's
                                checkout: the order that emptied it is one press away. */}
                            {latestPlaced === null ? null : (
                                <ShopStateButton
                                    testID="checkout-track-latest"
                                    label={t('commerce:checkout.successTrack')}
                                    onPress={() => {
                                        router.push(
                                            `/customer/orders/${latestPlaced.orderId}` as never,
                                        );
                                    }}
                                />
                            )}
                            <ShopStateButton
                                testID="checkout-browse"
                                kind={latestPlaced === null ? 'brand' : 'secondary'}
                                icon="arrowForward"
                                iconAfter
                                label={t('commerce:cart.browse')}
                                onPress={() => {
                                    router.push('/meals');
                                }}
                            />
                        </>
                    }
                    // A form page: rows while it loads, not a grid of dish cards.
                    skeleton="rows"
                    skeletonCount={2}
                    testID="checkout"
                >
                    <Columns
                        testID="checkout-layout"
                        wide={wide}
                        main={
                            <View
                                testID="checkout-step-card"
                                className="rounded-[26px] border border-stroke-subtle bg-surface-raised px-6 pb-6 pt-[22px] shadow-elevation-2"
                            >
                                {setupSteps.length === 0 ? null : (
                                    <View className="mb-6">
                                        <AccountSetupPanel
                                            testID="checkout-setup-required"
                                            role={refusedForSetup ? 'alert' : 'status'}
                                            title={t('commerce:checkout.setupTitle')}
                                            body={t('commerce:checkout.setupBody', {
                                                count: setupSteps.length,
                                            })}
                                            steps={setupSteps}
                                            stepsTestID="checkout-setup-step"
                                            returnTo={here}
                                        />
                                    </View>
                                )}
                                {committed === null ? deliveryStep : paymentStep}
                            </View>
                        }
                        aside={summary}
                    />
                </QueryStates>
            </View>
        </View>
    );
}

/* ── pieces ─────────────────────────────────────────────────────────────────────────────────── */

const STEP_KEYS = ['delivery', 'payment', 'placed'] as const;

/** How many delivery dates the board offers, from the earliest. */
const DATE_TILES = 6;

/** The page's top row: back to the basket, "Checkout", and the three-step progress beside it. */
function CheckoutTop({
    current,
    onBasket,
}: {
    /** 0 delivery, 1 payment, 2 confirmation. */
    readonly current: 0 | 1 | 2;
    readonly onBasket?: (() => void) | undefined;
}) {
    const { t } = useTranslation();
    // Shop · Checkout, phone board: "‹ Checkout" as the page's own bar, the steps under it.
    const phone = !useBreakpoint().atLeast('md');
    const steps = [
        t('commerce:checkout.steps.delivery'),
        t('commerce:checkout.steps.payment'),
        t('commerce:checkout.steps.placed'),
    ];
    return (
        <View className="flex-row flex-wrap items-center gap-3.5 pt-1">
            {phone && onBasket !== undefined ? (
                <View className="w-full">
                    <ShopPhoneTopBar
                        backTestID="checkout-back-basket"
                        backLabel={t('commerce:checkout.basket')}
                        onBack={onBasket}
                        titleTestID="checkout-title"
                        title={t('commerce:checkout.title')}
                    />
                </View>
            ) : (
                <>
                    {onBasket === undefined ? null : (
                        <BackPill
                            testID="checkout-back-basket"
                            label={t('commerce:checkout.basket')}
                            onPress={onBasket}
                            className="me-1.5"
                        />
                    )}
                    <RNText
                        testID="checkout-title"
                        role="heading"
                        aria-level={1}
                        className="font-display text-4xl font-bold tracking-display text-content-primary text-start"
                    >
                        {t('commerce:checkout.title')}
                    </RNText>
                </>
            )}
            <View
                testID="checkout-stepper"
                role="list"
                aria-label={t('commerce:checkout.progressLabel')}
                className="relative w-full max-w-[520px] flex-row md:ms-auto md:w-[420px]"
            >
                {/* The track between the first and last circle, filled up to the current step. */}
                <View
                    aria-hidden
                    className="absolute end-[16.6%] start-[16.6%] top-[15px] h-[3px] flex-row rounded-full bg-stroke-subtle"
                >
                    <View style={{ flex: current }} className="rounded-full bg-surface-brand" />
                    <View style={{ flex: 2 - current }} />
                </View>
                {steps.map((label, index) => {
                    const done = index < current;
                    const now = index === current;
                    return (
                        <View
                            key={label}
                            testID={`checkout-stepper-${STEP_KEYS[index] ?? 'placed'}`}
                            role="listitem"
                            aria-current={now ? 'step' : undefined}
                            className="flex-1 items-center gap-1.5"
                        >
                            <View
                                className={cx(
                                    'h-8 w-8 items-center justify-center rounded-full border-2',
                                    done
                                        ? 'border-surface-brand bg-surface-brand'
                                        : now
                                          ? 'border-surface-brand bg-surface-raised'
                                          : 'border-stroke bg-surface-raised',
                                )}
                            >
                                {done ? (
                                    <Icon
                                        name="check"
                                        size="sm"
                                        className="text-content-on-brand"
                                    />
                                ) : (
                                    <RNText
                                        className={cx(
                                            'text-sm font-bold',
                                            now
                                                ? 'text-content-on-brand-subtle'
                                                : 'text-content-secondary',
                                        )}
                                    >
                                        {String(index + 1)}
                                    </RNText>
                                )}
                            </View>
                            <RNText
                                className={cx(
                                    'text-sm font-semibold',
                                    now ? 'text-content-primary' : 'text-content-secondary',
                                )}
                            >
                                {label}
                            </RNText>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

/** The step card beside the summary from `lg`, above it below. */
function Columns({
    main,
    aside,
    wide,
    testID,
}: {
    readonly main: ReactNode;
    readonly aside: ReactNode;
    readonly wide: boolean;
    readonly testID: string;
}) {
    if (!wide) {
        return (
            <View testID={testID} className="flex-col gap-6">
                <View testID={`${testID}-main`}>{main}</View>
                <View testID={`${testID}-aside`}>{aside}</View>
            </View>
        );
    }
    return (
        <View testID={testID} className="flex-row items-start gap-6">
            <View testID={`${testID}-main`} className="min-w-0 flex-1">
                {main}
            </View>
            <View
                testID={`${testID}-aside`}
                className="z-auto w-[380px] shrink-0 self-start web:sticky web:top-0"
            >
                {aside}
            </View>
        </View>
    );
}

function PanelTitle({ title }: { readonly title: string }) {
    return (
        <RNText
            accessibilityRole="header"
            aria-level={2}
            className="mb-1 font-display text-2xl font-bold tracking-display text-content-primary text-start"
        >
            {title}
        </RNText>
    );
}

function PanelLabel({
    children,
    first = false,
}: {
    readonly children: string;
    readonly first?: boolean;
}) {
    return (
        <RNText
            className={cx(
                'mb-2.5 text-xs font-bold uppercase tracking-wider text-content-secondary text-start',
                first ? 'mt-1.5' : 'mt-5',
            )}
        >
            {children}
        </RNText>
    );
}

function PanelActions({ children }: { readonly children: ReactNode }) {
    // Shop · Checkout, phone board: the step's buttons in a bar docked to the screen's foot, so
    // Payment and Place order are always in reach rather than at the end of the form.
    const phone = !useBreakpoint().atLeast('md');
    if (phone) {
        return (
            <ShellDock>
                <View className="flex-row items-center gap-2.5 border-t border-stroke-subtle bg-surface-raised px-4 pb-5 pt-3">
                    {children}
                </View>
            </ShellDock>
        );
    }
    return (
        <View className="mt-6 flex-row items-center gap-2.5 border-t border-stroke-subtle pt-[18px]">
            {children}
        </View>
    );
}

function RadioDot({ on }: { readonly on: boolean }) {
    return (
        <View
            aria-hidden
            className={cx(
                'ms-auto h-[22px] w-[22px] items-center justify-center rounded-full border-2',
                on ? 'border-surface-brand' : 'border-stroke',
            )}
        >
            {on ? <View className="h-2.5 w-2.5 rounded-full bg-surface-brand" /> : null}
        </View>
    );
}

/** The board's option: an icon box, a title over a line, a radio dot at the end. */
function ChoiceTile({
    testID,
    icon,
    title,
    sub,
    badge,
    chosen,
    disabled = false,
    invalid = false,
    accessibilityHint,
    onPress,
}: {
    readonly testID: string;
    readonly icon: 'truck' | 'store' | 'mapPin';
    readonly title: string;
    readonly sub: string;
    readonly badge?: string | undefined;
    readonly chosen: boolean;
    readonly disabled?: boolean;
    readonly invalid?: boolean;
    readonly accessibilityHint?: string | undefined;
    readonly onPress?: (() => void) | undefined;
}) {
    return (
        <Pressable
            testID={testID}
            role="radio"
            aria-checked={chosen}
            accessibilityState={{ checked: chosen, selected: chosen, disabled }}
            {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
            disabled={disabled || onPress === undefined}
            onPress={onPress}
            className={cx(
                'min-h-16 min-w-[220px] flex-1 flex-row items-center gap-3 rounded-[18px] border-[1.5px] px-3.5 py-3 transition duration-normal ease-standard',
                chosen
                    ? 'border-surface-brand bg-surface-brand-subtle shadow-elevation-1'
                    : disabled
                      ? 'border-dashed border-stroke bg-surface-raised opacity-50'
                      : cx(
                            'bg-surface-raised hover:border-surface-brand',
                            invalid ? 'border-danger-border' : 'border-stroke',
                        ),
            )}
        >
            <View
                className={cx(
                    'h-10 w-10 items-center justify-center rounded-xl',
                    chosen ? 'bg-surface-raised' : 'bg-surface-base',
                )}
            >
                <Icon name={icon} size="sm" className="text-content-on-brand-subtle" />
            </View>
            <View className="min-w-0 flex-1">
                <View className="flex-row flex-wrap items-center gap-1.5">
                    <RNText className="text-base font-bold text-content-primary text-start">
                        {title}
                    </RNText>
                    {badge === undefined ? null : (
                        <View className="h-5 justify-center rounded-full bg-surface-brand px-[7px]">
                            <RNText className="text-xs font-bold uppercase tracking-wide text-content-on-brand">
                                {badge}
                            </RNText>
                        </View>
                    )}
                </View>
                <RNText
                    numberOfLines={2}
                    className="mt-px text-sm font-medium text-content-secondary text-start"
                >
                    {sub}
                </RNText>
            </View>
            <RadioDot on={chosen} />
        </Pressable>
    );
}

/** One committed choice on the payment step, with "Change" back to the delivery step. */
function ReviewCell({
    testID,
    label,
    value,
    onChange,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
    readonly onChange: () => void;
}) {
    const { t } = useTranslation();
    return (
        <View className="min-w-[220px] flex-1 rounded-2xl border border-stroke-subtle bg-surface-base px-4 py-3.5">
            <RNText className="text-xs font-semibold text-content-secondary text-start">
                {label}
            </RNText>
            <RNText
                testID={testID}
                className="mt-0.5 text-base font-bold text-content-primary text-start"
            >
                {value}
            </RNText>
            <Pressable
                testID={`${testID}-change`}
                role="button"
                accessibilityRole="button"
                onPress={onChange}
                className="mt-1.5 self-start"
            >
                <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                    {t('commerce:checkout.change')}
                </RNText>
            </Pressable>
        </View>
    );
}

/** The board's main button: a label and an arrow in a soft circle; a spinner while it works. */
function ArrowAction({
    testID,
    label,
    disabled = false,
    loading = false,
    accessibilityHint,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly disabled?: boolean;
    readonly loading?: boolean;
    readonly accessibilityHint?: string | undefined;
    readonly onPress: () => void;
}) {
    const off = disabled || loading;
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
            accessibilityState={{ disabled: off, busy: loading }}
            disabled={off}
            onPress={onPress}
            className={cx(
                'h-14 min-w-0 flex-1 flex-row items-center rounded-2xl px-5',
                loading ? 'justify-center' : 'justify-between',
                disabled ? 'bg-stroke-subtle' : 'bg-surface-brand hover:bg-surface-canopy',
            )}
        >
            {loading ? (
                <ActivityIndicator size="small" />
            ) : (
                <>
                    <RNText
                        numberOfLines={1}
                        className={cx(
                            'shrink text-base font-bold',
                            disabled ? 'text-content-secondary' : 'text-content-on-brand',
                        )}
                    >
                        {label}
                    </RNText>
                    <View className="h-8 w-8 items-center justify-center rounded-full bg-content-on-brand/20">
                        <Icon
                            name="chevronForward"
                            size="sm"
                            className={
                                disabled ? 'text-content-secondary' : 'text-content-on-brand'
                            }
                        />
                    </View>
                </>
            )}
        </Pressable>
    );
}

/** The order summary: the total on the canopy, then what is inside. */
function SummaryCard({
    testID,
    countTestID,
    total,
    itemCount,
    children,
}: {
    readonly testID: string;
    readonly countTestID?: string | undefined;
    readonly total: string | null;
    readonly itemCount: number;
    readonly children: ReactNode;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    return (
        <View
            testID={testID}
            className="overflow-hidden rounded-[26px] border border-stroke-subtle bg-surface-raised shadow-elevation-2"
        >
            <View className="relative overflow-hidden bg-surface-canopy px-5 py-[18px]">
                <View
                    aria-hidden
                    pointerEvents="none"
                    className="absolute -end-16 -top-20 h-48 w-48 rounded-full bg-stage-green opacity-15"
                />
                <RNText className="text-xs font-semibold uppercase tracking-wider text-content-on-canopy-muted">
                    {t('commerce:cart.summaryTitle')}
                </RNText>
                <View className="mt-1.5 flex-row items-baseline justify-between gap-3">
                    <RNText className="font-display text-4xl font-bold tabular-nums tracking-display text-content-on-canopy">
                        {total ?? '—'}
                    </RNText>
                    <RNText testID={countTestID} className="text-sm text-content-on-canopy-muted">
                        {t('commerce:checkout.itemCount', {
                            count: itemCount,
                            items: formatter.formatNumber(itemCount),
                        })}
                    </RNText>
                </View>
            </View>
            <View className="px-5 pb-5 pt-3">{children}</View>
        </View>
    );
}

/** One line of the summary: the dish's picture, its name and "2 × $9.00", its total. */
function MiniLine({
    testID,
    name,
    mealId,
    quantity,
    unit,
    total,
    clash,
}: {
    readonly testID: string;
    readonly name: string;
    readonly mealId?: MealId | undefined;
    readonly quantity: number;
    readonly unit: string;
    readonly total: string;
    /** The dish crosses the allergy list: the tag under the line. */
    readonly clash?: string | undefined;
}) {
    const formatter = useFormatter();
    const meal = useMealQuery(mealId ?? null);
    return (
        <View className="flex-col">
            <View testID={testID} className="flex-row items-center gap-3 py-2">
                <View className="h-12 w-12 overflow-hidden rounded-xl">
                    <EntityImage
                        assetId={meal.data?.imagePlaceholderId}
                        photoUrl={meal.data?.photoUrl}
                        variant="card"
                        seed={meal.data?.slug ?? name}
                        label={name}
                        decorative
                        flush
                        className="h-full w-full"
                    />
                </View>
                <View className="min-w-0 flex-1">
                    <RNText
                        numberOfLines={1}
                        className="text-sm font-semibold text-content-primary text-start"
                    >
                        {name}
                    </RNText>
                    <RNText className="text-xs font-medium tabular-nums text-content-secondary text-start">
                        {`${formatter.formatNumber(quantity)} × ${unit}`}
                    </RNText>
                </View>
                <RNText className="text-sm font-bold tabular-nums text-content-primary">
                    {total}
                </RNText>
            </View>
            {clash === undefined ? null : (
                <View
                    testID={`${testID}-clash`}
                    role="alert"
                    className="-mt-1 mb-1.5 ms-[60px] h-6 flex-row items-center gap-1.5 self-start rounded-full bg-danger-subtle px-2.5"
                >
                    <Icon name="shield" size="sm" className="text-danger-on-subtle" />
                    <RNText className="text-xs font-bold text-danger-on-subtle">{clash}</RNText>
                </View>
            )}
        </View>
    );
}

/** Where, when and how it is paid, under the total. */
function DeliveryFacts({
    address,
    when,
}: {
    readonly address: string | null;
    readonly when: string | null;
}) {
    const { t } = useTranslation();
    const facts = [
        { key: 'address', icon: 'mapPin' as const, text: address },
        { key: 'when', icon: 'calendar' as const, text: when },
        { key: 'pay', icon: 'banknote' as const, text: t('commerce:checkout.paymentCod') },
    ].filter(
        (fact): fact is { key: string; icon: 'mapPin' | 'calendar' | 'banknote'; text: string } =>
            fact.text !== null,
    );
    return (
        <View
            testID="checkout-facts"
            className="mt-3 flex-col gap-1.5 rounded-[14px] bg-surface-base px-3.5 py-3"
        >
            {facts.map((fact) => (
                <View key={fact.key} className="flex-row items-center gap-2">
                    <Icon name={fact.icon} size="sm" className="text-content-on-brand-subtle" />
                    <RNText className="min-w-0 flex-1 text-sm font-bold text-content-primary text-start">
                        {fact.text}
                    </RNText>
                </View>
            ))}
        </View>
    );
}

interface OrderPlacedProps {
    readonly order: PlacedOrder;
    readonly kitchenName: string | null;
    /** "Midday on 13 Aug 2026" — the committed window, already worded. */
    readonly arriving: string;
    readonly onTrack: () => void;
    readonly onKeepShopping: () => void;
}

/**
 * The confirmation, as the board's third step: the big tick, "Order … confirmed", one line, "Keep
 * shopping" and "Track this order" — and beside it the order's own lines and total.
 *
 * Priced from the order, not from the checkout preview. Placement empties the basket, which disables
 * the preview query — a confirmation that read its figures from there rendered an empty price block.
 * The placed order carries the figures the platform actually charged for.
 *
 * "Track this order" goes to `/customer/orders/{order}` — the identifier, not the printed reference,
 * because that is what `GET /me/orders/{order}` takes.
 */
function OrderPlaced({ order, kitchenName, arriving, onTrack, onKeepShopping }: OrderPlacedProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const wide = useBreakpoint().atLeast('lg');
    const count = order.lines.reduce((sum, line) => sum + line.quantity, 0);

    const main = (
        <View
            testID="checkout-success-card"
            className="items-center rounded-[26px] border border-stroke-subtle bg-surface-raised px-6 pb-7 pt-[34px] shadow-elevation-2"
        >
            <View className="rounded-full bg-surface-brand-subtle p-3">
                <View className="h-[92px] w-[92px] items-center justify-center rounded-full bg-surface-brand">
                    <Icon name="check" size="lg" className="text-content-on-brand" />
                </View>
            </View>
            <RNText
                testID="checkout-success-title"
                accessibilityRole="header"
                aria-level={2}
                className="mb-1.5 mt-[26px] font-display text-3xl font-bold tracking-display text-content-primary text-center"
            >
                {t('commerce:checkout.confirmedTitle', { reference: order.reference })}
            </RNText>
            <RNText
                testID="checkout-success-body"
                role="status"
                className="max-w-[440px] text-base font-medium leading-normal text-content-secondary text-center"
            >
                {t('commerce:checkout.confirmedBody', {
                    kitchen: kitchenName ?? t('commerce:checkout.theKitchen'),
                    arriving,
                })}
            </RNText>
            <View className="mt-6 w-full max-w-[440px] flex-row items-center gap-2.5">
                <Pressable
                    testID="checkout-success-keep-shopping"
                    role="button"
                    accessibilityRole="button"
                    onPress={onKeepShopping}
                    className="h-[52px] justify-center rounded-2xl border border-stroke px-[18px] hover:bg-surface-brand-subtle"
                >
                    <RNText className="text-base font-semibold text-content-primary">
                        {t('commerce:cart.keepShopping')}
                    </RNText>
                </Pressable>
                <ArrowAction
                    testID="checkout-success-track"
                    label={t('commerce:checkout.successTrack')}
                    onPress={onTrack}
                />
            </View>
        </View>
    );

    const aside = (
        <SummaryCard
            testID="checkout-receipt"
            total={formatMoney(formatter, order.total)}
            itemCount={count}
        >
            {order.lines.map((line) => (
                <MiniLine
                    key={line.id}
                    testID={`checkout-receipt-${line.id}`}
                    name={line.name}
                    quantity={line.quantity}
                    unit={formatMoney(formatter, line.unitPrice)}
                    total={formatMoney(formatter, line.lineTotal)}
                />
            ))}
            <View className="mt-2 flex-row items-baseline justify-between border-t border-dashed border-stroke pt-3">
                <RNText className="text-sm text-content-secondary">
                    {t('commerce:cart.total')}
                </RNText>
                <RNText
                    testID="checkout-receipt-total-amount"
                    className="font-display text-2xl font-bold tabular-nums tracking-display text-content-primary"
                >
                    {formatMoney(formatter, order.total)}
                </RNText>
            </View>
        </SummaryCard>
    );

    return <Columns testID="checkout-success-layout" wide={wide} main={main} aside={aside} />;
}

/** A basket line in the allergen pop-up: its photo, name, quantity × price, and its allergens on amber. */
function ClashLine({
    testID,
    name,
    mealId,
    meta,
    allergens,
}: {
    readonly testID: string;
    readonly name: string;
    readonly mealId: MealId;
    readonly meta: string;
    readonly allergens: readonly string[];
}) {
    const meal = useMealQuery(mealId);
    return (
        <ShopDialogSubject
            testID={testID}
            lead={
                <View className="h-[52px] w-[52px] overflow-hidden rounded-[14px]">
                    <EntityImage
                        assetId={meal.data?.imagePlaceholderId}
                        photoUrl={meal.data?.photoUrl}
                        variant="card"
                        seed={meal.data?.slug ?? name}
                        label={name}
                        decorative
                        flush
                        className="h-full w-full"
                    />
                </View>
            }
            name={name}
            meta={meta}
            end={
                <View className="flex-row flex-wrap justify-end gap-1">
                    {allergens.map((allergen) => (
                        <View
                            key={allergen}
                            className="h-[26px] flex-row items-center gap-1 rounded-full bg-warning-strong px-2.5"
                        >
                            <Icon name="alert" size="sm" className="text-warning-on-strong" />
                            <RNText className="text-xs font-bold text-warning-on-strong">
                                {allergen}
                            </RNText>
                        </View>
                    ))}
                </View>
            }
        />
    );
}

/**
 * A tile that stands in a section's place when it cannot be answered yet — no saved address, no
 * delivery window — saying what is wrong and, when there is one, the action that fixes it
 * (Basket + checkout, pins 2 and 3).
 */
function DashedTile({
    testID,
    icon,
    title,
    body,
    action,
    tone = 'brand',
    role,
}: {
    readonly testID: string;
    readonly icon: 'mapPin' | 'clock';
    readonly title: string;
    readonly body: string;
    readonly action?: ReactNode | undefined;
    readonly tone?: 'brand' | 'warning' | undefined;
    readonly role?: 'alert' | undefined;
}) {
    const warning = tone === 'warning';
    return (
        <View
            testID={testID}
            role={role}
            className={cx(
                'flex-row flex-wrap items-center gap-3.5 rounded-[18px] border-[1.5px] border-dashed p-4',
                warning
                    ? 'border-warning-border bg-warning-subtle'
                    : 'border-stroke bg-surface-base',
            )}
        >
            <View className="h-[46px] w-[46px] items-center justify-center rounded-[15px] bg-surface-raised shadow-elevation-1">
                <Icon
                    name={icon}
                    size="lg"
                    className={warning ? 'text-warning-on-subtle' : 'text-content-on-brand-subtle'}
                />
            </View>
            <View className="min-w-[200px] flex-1">
                <RNText
                    className={cx(
                        'text-base font-bold leading-5 text-start',
                        warning ? 'text-warning-on-subtle' : 'text-content-primary',
                    )}
                >
                    {title}
                </RNText>
                <RNText
                    className={cx(
                        'mt-0.5 text-sm leading-[18px] text-start',
                        warning ? 'text-warning-on-subtle' : 'text-content-secondary',
                    )}
                >
                    {body}
                </RNText>
            </View>
            {action}
        </View>
    );
}
