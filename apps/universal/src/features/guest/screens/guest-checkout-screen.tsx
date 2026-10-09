import {
    Button,
    Callout,
    Checkbox,
    DateField,
    Icon,
    Skeleton,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { useCartQuery, useCheckoutPreviewQuery } from '../../../data/commerce-hooks.ts';
import {
    toFailure,
    useConfirmGuestContactMutation,
    useGuestSessionQuery,
    useGuestToken,
    usePlaceGuestOrderMutation,
    useStartGuestSessionMutation,
    useUpdateGuestContactMutation,
} from '../../../data/guest-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { useValidationTranslate } from '../../../screens/form-helpers.ts';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { EMPTY_ADDRESS, toDeliveryAddress, validateAddress } from '../../commerce/address.ts';
import type { AddressValues } from '../../commerce/address.ts';
import {
    CheckoutCard,
    CheckoutColumns,
    CheckoutPage,
    CheckoutTitle,
    ChoiceChips,
    FieldCell,
    FieldRow,
    NumberDot,
    SummaryItems,
    SummaryRow,
    SummaryTotal,
    TextLink,
    priceLineLabel,
} from '../../commerce/checkout-frame.tsx';
import { earliestStartDate } from '../../commerce/dates.ts';
import {
    defaultSlotCode,
    deliveryAreaStatus,
    deliverySlotByCode,
    deliverySlotsForKitchen,
    offeredSlots,
    servedAreas,
    zoneWindowCodes,
} from '../../commerce/delivery.ts';
import { formatMoney } from '../../marketplace/format.ts';
import {
    EMPTY_GUEST_CONTACT,
    availableChannels,
    resolveChannel,
    toContactRequest,
    validateGuestContact,
} from '../contact.ts';
import type { GuestContactChannel, GuestContactValues } from '../contact.ts';
import { GuestChallenge } from '../guest-challenge.tsx';

/**
 * `/guest-checkout` — ordering without an account, as HealthZone's `guest` screen draws it: the
 * title with "NO ACCOUNT NEEDED · CASH ON DELIVERY AVAILABLE" beside it, four numbered cards — who
 * is this for, where it goes, when, how you pay — all open at once down the main column, the dashed
 * "save this order to an account?" band under them, and a sticky order summary carrying "Place
 * order".
 *
 * ## The gates live inside the cards
 *
 * Everything is on the page from the first frame, as the design draws it, and every gate the
 * journey had survives in the card it belongs to:
 *
 * - **The passcode** sits in card 1. "Send me a code" starts the session and sends a code to the
 *   contact just typed; the code panel opens beneath it, and a proven contact collapses to one
 *   confirmed line with "Change". The fields lock while a code is live, because a code proves the
 *   contact it was sent to and not the one somebody edits afterwards.
 * - **The out-of-zone stop** sits in card 2. The area is checked against the kitchen's own
 *   published zones as it is typed, and `unserved` disables "Place order" — there is no "continue
 *   anyway", because continuing leads to a placed order for food that cannot be delivered.
 *   `unknown` is a real third answer and is **not** a refusal: a kitchen that publishes no zones
 *   has told us nothing.
 * - **Slots follow the zone.** Once the typed area matches a zone, card 3 offers only the slots
 *   that zone runs (its published `windowCodes`) — placement refuses any other with
 *   `window_not_offered`. A zone running none says so and disables "Place order". An unmatched area
 *   filters nothing.
 * - **Placement** is the server's answer. "Place order" stays disabled until the session's
 *   `capabilities` include `place_order`; the client never decides the gate.
 *
 * ## Marketing is off, and "off" is sent
 *
 * The checkbox in card 1 starts unticked and its value is sent explicitly on the draft. An opt-in
 * that arrives absent is one somebody has to interpret.
 *
 * ## A timed-out session returns to card 1 with the basket intact
 *
 * Guest sessions are deliberately short. When the token stops resolving, the screen says so and
 * unlocks the contact card; the basket is not part of the guest session, and losing one must not
 * look like losing the other.
 *
 * ## What the design draws that this does not
 *
 * - **Payment** is one chip. There is one method, cash on delivery, and it is a one-member type in
 *   the contract (`contracts/guest.ts`); "Card at the door" and "Pay now by card" would be choices
 *   a guest order cannot carry.
 * - **Postcode** is Area, City and Country. The delivery address the order carries has no postcode
 *   and is matched to a zone by area; the country is pre-filled from the kitchen's own. The
 *   address's name is set for the person ("Delivery address") — a guest has no address book for a
 *   name to tell entries apart in.
 * - The drop-off chips are the design's, minus "Buzz 3" (somebody's buzzer, not an option), and
 *   none is chosen until somebody chooses one — an instruction the person did not give is not sent.
 * - The account band's button is "Sign in instead". The design's "Create account later" would do
 *   nothing: the offer to keep the order in an account is made on the order page after placing,
 *   where there is an order to keep.
 */

const TEST_ID = 'guest-checkout';

const DROP_OFF_OPTIONS = ['leave', 'hand', 'call'] as const;
type DropOff = (typeof DROP_OFF_OPTIONS)[number];

export function GuestCheckoutScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const validationTranslate = useValidationTranslate();

    const token = useGuestToken();
    const session = useGuestSessionQuery();
    const start = useStartGuestSessionMutation();
    const updateContact = useUpdateGuestContactMutation();
    const confirmContact = useConfirmGuestContactMutation();
    const place = usePlaceGuestOrderMutation();

    const cart = useCartQuery();
    const basket = cart.data;

    const [contact, setContact] = useState<GuestContactValues>(EMPTY_GUEST_CONTACT);
    const [address, setAddress] = useState<AddressValues>(EMPTY_ADDRESS);
    const [dropOff, setDropOff] = useState<DropOff | null>(null);
    const [chosenSlotCode, setSlotCode] = useState<string | null>(null);
    const [deliveryDate, setDeliveryDate] = useState<string>(() => earliestStartDate());
    // Off unless turned on, and sent either way. See the header.
    const [marketingOptIn, setMarketingOptIn] = useState(false);
    const [showContactErrors, setShowContactErrors] = useState(false);
    const [showAddressErrors, setShowAddressErrors] = useState(false);
    const [codeSent, setCodeSent] = useState(false);
    const [challengeId, setChallengeId] = useState<string | null>(null);
    const [contactConfirmed, setContactConfirmed] = useState(false);

    /**
     * The session has died mid-checkout. Read from the *query*, not from the token: a token can
     * still be in the store while the server has already stopped honouring it.
     */
    const sessionFailure = toFailure(session.error);
    const sessionExpired =
        sessionFailure !== null && sessionFailure.code === 'auth.unauthenticated';

    /** The kitchen the basket is from — the only source of a real delivery-zone answer. */
    const kitchenId = basket?.items[0]?.kitchenId ?? null;
    const kitchen = useKitchenQuery(kitchenId);
    // Only the matched zone's slots; a choice it does not run falls back to the default over them.
    const deliverySlots = offeredSlots(
        deliverySlotsForKitchen(kitchen.data),
        zoneWindowCodes(kitchen.data, address.area),
    );
    const chosenSlotIsOffered =
        chosenSlotCode !== null && deliverySlots.some((slot) => slot.code === chosenSlotCode);
    const slotCode = chosenSlotIsOffered ? chosenSlotCode : defaultSlotCode(deliverySlots);

    const dropOffLabel = (option: DropOff) => t(`guest:address.dropOff.${option}`);

    /**
     * The address as the order carries it: what was typed, plus the two parts the person is not
     * asked for — the country defaults to the kitchen's own (it delivers nowhere else), and the
     * address's name is ours, because a guest has no list of addresses for a name to tell apart.
     */
    const orderAddress: AddressValues = {
        ...address,
        label: t('guest:address.defaultLabel'),
        countryCode:
            address.countryCode.trim() === ''
                ? (kitchen.data?.countryCode ?? '')
                : address.countryCode,
        instructions: dropOff === null ? '' : dropOffLabel(dropOff),
    };

    const contactErrors = useMemo(
        () => validateGuestContact(contact, validationTranslate),
        [contact, validationTranslate],
    );
    const addressErrors = validateAddress(orderAddress, validationTranslate);
    const shownAddressErrors = showAddressErrors ? addressErrors : {};
    const shownContactErrors = showContactErrors ? contactErrors : {};

    const areaStatus = deliveryAreaStatus(kitchen.data, address.area);
    const outOfZone = areaStatus === 'unserved';

    const basketIsEmpty = basket !== undefined && basket.items.length === 0;
    const preview = useCheckoutPreviewQuery(
        basket === undefined || basket.items.length === 0 ? null : { cartId: basket.id },
    );

    const capabilities = session.data?.capabilities ?? [];
    const canPlace = capabilities.includes('place_order');
    const placeFailure = toFailure(place.error);

    const destination =
        session.data?.contact?.maskedDestination ??
        (contact.email.trim().length > 0 ? contact.email : contact.mobile);

    const sending = updateContact.isPending || start.isPending;
    const contactLocked = codeSent || contactConfirmed || sending;

    /* ── card 1: send the code ──────────────────────────────────────────────────────────────── */

    const onSendCode = () => {
        setShowContactErrors(true);
        if (Object.keys(contactErrors).length > 0) return;

        const request = toContactRequest(contact);
        const withSession = () => {
            updateContact.mutate(request, {
                onSuccess: (result) => {
                    setChallengeId(result.challenge?.id ?? null);
                    setCodeSent(true);
                    setShowContactErrors(false);
                },
            });
        };

        // A session is started lazily, here, rather than on mount: a person browsing the checkout
        // and leaving should not have a credential minted for them.
        if (token === null || sessionExpired) start.mutate(undefined, { onSuccess: withSession });
        else withSession();
    };

    const resetContact = () => {
        setCodeSent(false);
        setChallengeId(null);
        setContactConfirmed(false);
    };

    const onPlace = () => {
        if (basket === undefined) return;
        setShowAddressErrors(true);
        if (Object.keys(addressErrors).length > 0 || outOfZone || slotCode === null) return;
        place.mutate(
            {
                cartId: basket.id,
                address: toDeliveryAddress(orderAddress),
                slotCode,
                deliveryDate,
                paymentMethod: 'cash_on_delivery',
                marketingOptIn,
            },
            {
                onSuccess: (order) => {
                    router.push(`/orders/${order.reference}` as never);
                },
            },
        );
    };

    const setAddressField = (field: keyof AddressValues) => (next: string) => {
        setAddress((current) => ({ ...current, [field]: next }));
    };

    const channels = availableChannels(contact);
    const channelLabel = (channel: GuestContactChannel) =>
        t(
            channel === 'email'
                ? 'guest:contact.channelEmail'
                : channel === 'sms'
                  ? 'guest:contact.channelSms'
                  : 'guest:contact.channelWhatsapp',
        );

    /* ── the four cards ─────────────────────────────────────────────────────────────────────── */

    const blocks = (
        <View className="flex-col gap-3" testID={`${TEST_ID}-progress`}>
            {/* 1 · who is this for */}
            <Block number={1} title={t('guest:contact.title')}>
                <View className="flex-col gap-3" testID={`${TEST_ID}-contact`}>
                    <FieldRow>
                        <FieldCell>
                            <TextInputField
                                testID={`${TEST_ID}-contact-fullName`}
                                label={t('guest:contact.fullName')}
                                placeholder={t('guest:contact.fullName')}
                                value={contact.fullName}
                                onChangeText={(next: string) => {
                                    setContact((current) => ({ ...current, fullName: next }));
                                }}
                                required
                                autoCapitalize="words"
                                disabled={contactLocked}
                                {...(shownContactErrors.fullName === undefined
                                    ? {}
                                    : { error: shownContactErrors.fullName })}
                            />
                        </FieldCell>
                        <FieldCell>
                            <TextInputField
                                testID={`${TEST_ID}-contact-mobile`}
                                label={t('guest:contact.mobile')}
                                placeholder={t('guest:contact.mobilePlaceholder')}
                                value={contact.mobile}
                                onChangeText={(next: string) => {
                                    setContact((current) => ({ ...current, mobile: next }));
                                }}
                                keyboardType="phone-pad"
                                autoCapitalize="none"
                                disabled={contactLocked}
                                {...(shownContactErrors.mobile === undefined
                                    ? {}
                                    : { error: shownContactErrors.mobile })}
                            />
                        </FieldCell>
                    </FieldRow>
                    <FieldRow>
                        <FieldCell>
                            <TextInputField
                                testID={`${TEST_ID}-contact-email`}
                                label={t('guest:contact.email')}
                                placeholder={t('auth:login.emailPlaceholder')}
                                value={contact.email}
                                onChangeText={(next: string) => {
                                    setContact((current) => ({ ...current, email: next }));
                                }}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                disabled={contactLocked}
                                {...(shownContactErrors.email === undefined
                                    ? {}
                                    : { error: shownContactErrors.email })}
                            />
                        </FieldCell>
                    </FieldRow>
                </View>

                {channels.length === 0 ? null : (
                    <View className="mt-3">
                        <ChoiceChips
                            testID={`${TEST_ID}-contact-channel`}
                            label={t('guest:contact.channel')}
                            value={resolveChannel(contact)}
                            disabled={contactLocked}
                            onChange={(next) => {
                                setContact((current) => ({
                                    ...current,
                                    channel: next as GuestContactChannel,
                                }));
                            }}
                            options={channels.map((channel) => ({
                                value: channel,
                                label: channelLabel(channel),
                                testID: `${TEST_ID}-contact-channel-${channel}`,
                            }))}
                        />
                    </View>
                )}

                <View className="mt-3">
                    <Checkbox
                        testID={`${TEST_ID}-marketing`}
                        label={t('guest:review.marketingLabel')}
                        checked={marketingOptIn}
                        onChange={setMarketingOptIn}
                    />
                </View>

                <View className="mt-3">
                    {contactConfirmed ? (
                        <View
                            testID={`${TEST_ID}-contact-summary`}
                            className="flex-row flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-brand-subtle px-3 py-2"
                        >
                            <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                            <RNText className="min-w-0 flex-1 text-sm font-medium text-content-on-brand-subtle text-start">
                                {t('guest:verify.confirmedAs', {
                                    name: contact.fullName.trim(),
                                    destination:
                                        session.data?.contact?.maskedDestination ?? destination,
                                })}
                            </RNText>
                            <TextLink
                                testID={`${TEST_ID}-block-1-change`}
                                label={t('guest:change')}
                                onPress={resetContact}
                            />
                        </View>
                    ) : codeSent ? (
                        <View className="flex-col gap-3" testID={`${TEST_ID}-verify-step`}>
                            <Text tone="secondary" variant="caption">
                                {t('guest:verify.subtitle', { destination })}
                            </Text>
                            {challengeId === null ? null : (
                                <GuestChallenge
                                    testID={`${TEST_ID}-challenge`}
                                    challengeId={challengeId}
                                    verifying={confirmContact.isPending}
                                    verifyFailure={toFailure(confirmContact.error)}
                                    onVerify={(code, liveChallengeId) => {
                                        confirmContact.mutate(
                                            { challengeId: liveChallengeId, code },
                                            {
                                                onSuccess: () => {
                                                    setContactConfirmed(true);
                                                },
                                            },
                                        );
                                    }}
                                />
                            )}
                            <View className="flex-row">
                                <TextLink
                                    testID={`${TEST_ID}-verify-back`}
                                    tone="muted"
                                    label={t('guest:verify.back')}
                                    onPress={resetContact}
                                />
                            </View>
                        </View>
                    ) : (
                        <View className="flex-row">
                            <Button
                                testID={`${TEST_ID}-contact-continue`}
                                variant="secondary"
                                size="sm"
                                label={t('guest:contact.continue')}
                                loading={sending}
                                onPress={onSendCode}
                            />
                        </View>
                    )}
                </View>
            </Block>

            {/* 2 · where it goes */}
            <Block number={2} title={t('guest:address.title')}>
                <View className="flex-col gap-3" testID={`${TEST_ID}-address`}>
                    <FieldRow>
                        <FieldCell>
                            <TextInputField
                                testID={`${TEST_ID}-address-line1`}
                                label={t('guest:address.line1')}
                                placeholder={t('guest:address.line1')}
                                value={address.line1}
                                onChangeText={setAddressField('line1')}
                                required
                                autoCapitalize="words"
                                {...(shownAddressErrors.line1 === undefined
                                    ? {}
                                    : { error: shownAddressErrors.line1 })}
                            />
                        </FieldCell>
                    </FieldRow>
                    <FieldRow>
                        <FieldCell>
                            <TextInputField
                                testID={`${TEST_ID}-address-line2`}
                                label={t('guest:address.line2')}
                                placeholder={t('guest:address.line2')}
                                value={address.line2}
                                onChangeText={setAddressField('line2')}
                                autoCapitalize="words"
                                {...(shownAddressErrors.line2 === undefined
                                    ? {}
                                    : { error: shownAddressErrors.line2 })}
                            />
                        </FieldCell>
                        <FieldCell>
                            <TextInputField
                                testID={`${TEST_ID}-address-area`}
                                label={t('guest:address.area')}
                                placeholder={t('guest:address.area')}
                                value={address.area}
                                onChangeText={setAddressField('area')}
                                required
                                autoCapitalize="words"
                                {...(shownAddressErrors.area === undefined
                                    ? {}
                                    : { error: shownAddressErrors.area })}
                            />
                        </FieldCell>
                    </FieldRow>
                    <FieldRow>
                        <FieldCell>
                            <TextInputField
                                testID={`${TEST_ID}-address-city`}
                                label={t('guest:address.city')}
                                placeholder={t('guest:address.city')}
                                value={address.city}
                                onChangeText={setAddressField('city')}
                                required
                                autoCapitalize="words"
                                {...(shownAddressErrors.city === undefined
                                    ? {}
                                    : { error: shownAddressErrors.city })}
                            />
                        </FieldCell>
                        <FieldCell>
                            <TextInputField
                                testID={`${TEST_ID}-address-countryCode`}
                                label={t('guest:address.countryCode')}
                                placeholder={t('guest:address.countryCode')}
                                value={orderAddress.countryCode}
                                onChangeText={setAddressField('countryCode')}
                                required
                                autoCapitalize="characters"
                                {...(shownAddressErrors.countryCode === undefined
                                    ? {}
                                    : { error: shownAddressErrors.countryCode })}
                            />
                        </FieldCell>
                    </FieldRow>
                </View>

                {outOfZone ? (
                    <View className="mt-3">
                        <Callout
                            testID={`${TEST_ID}-out-of-zone`}
                            role="alert"
                            tone="danger"
                            title={t('guest:address.outOfZoneTitle', { area: address.area })}
                            body={t('guest:address.outOfZoneBody')}
                            actions={
                                <Button
                                    testID={`${TEST_ID}-out-of-zone-browse`}
                                    variant="secondary"
                                    label={t('guest:address.outOfZoneBrowse')}
                                    onPress={() => {
                                        router.push('/kitchens');
                                    }}
                                />
                            }
                        >
                            <Text tone="secondary" variant="caption">
                                {t('guest:address.outOfZoneAreas', {
                                    areas: servedAreas(kitchen.data).join(', '),
                                })}
                            </Text>
                        </Callout>
                    </View>
                ) : null}

                <View className="mt-3">
                    <ChoiceChips
                        testID={`${TEST_ID}-drop-off`}
                        label={t('guest:address.dropOffLabel')}
                        value={dropOff}
                        onChange={(next) => {
                            // Pressing the chosen instruction again takes it back: none is sent
                            // unless somebody chose one.
                            setDropOff((current) => (current === next ? null : (next as DropOff)));
                        }}
                        options={DROP_OFF_OPTIONS.map((option) => ({
                            value: option,
                            label: dropOffLabel(option),
                            testID: `${TEST_ID}-drop-off-${option}`,
                        }))}
                    />
                </View>
            </Block>

            {/* 3 · when */}
            <Block number={3} title={t('guest:when.title')}>
                <FieldRow>
                    <FieldCell>
                        <DateField
                            testID={`${TEST_ID}-date`}
                            label={t('guest:address.date')}
                            value={deliveryDate}
                            min={earliestStartDate()}
                            onChange={(next: string | null) => {
                                setDeliveryDate(next ?? earliestStartDate());
                            }}
                        />
                    </FieldCell>
                    <FieldCell>{null}</FieldCell>
                </FieldRow>
                <View className="mt-3">
                    {slotCode === null ? (
                        <Callout
                            testID={`${TEST_ID}-slot-none`}
                            role="alert"
                            tone="warning"
                            icon="warning"
                            title={t('guest:address.slot')}
                            body={t('guest:when.noSlots', { area: address.area })}
                        />
                    ) : (
                        <ChoiceChips
                            testID={`${TEST_ID}-slot`}
                            label={t('guest:address.slot')}
                            options={deliverySlots.map((slot) => ({
                                value: slot.code,
                                label: t('commerce:checkout.slotChip', {
                                    slot:
                                        deliverySlotByCode(slot.code, kitchen.data)?.label ??
                                        t(`commerce:slots.${slot.code}`, {
                                            defaultValue: slot.code,
                                        }),
                                    from: slot.startsAt,
                                    to: slot.endsAt,
                                }),
                                testID: `${TEST_ID}-slot-${slot.code}`,
                            }))}
                            value={slotCode}
                            onChange={setSlotCode}
                        />
                    )}
                </View>
            </Block>

            {/* 4 · how you pay */}
            <Block number={4} title={t('guest:pay.title')}>
                <ChoiceChips
                    testID={`${TEST_ID}-payment`}
                    label={t('guest:pay.title')}
                    // The only method there is, so there is nothing to change it to.
                    value="cash_on_delivery"
                    options={[
                        {
                            value: 'cash_on_delivery',
                            label: t('guest:review.cashOnDelivery'),
                            testID: `${TEST_ID}-payment-cash`,
                        },
                    ]}
                />
            </Block>

            {/* The design's dashed "save this order to an account?" band. */}
            <View
                testID={`${TEST_ID}-account-band`}
                className="flex-row flex-wrap items-center gap-3 rounded-lg border border-dashed border-stroke-strong bg-surface-sunken px-5 py-4"
            >
                <View className="min-w-[240px] flex-1 flex-col gap-1">
                    <RNText className="font-display text-base font-bold tracking-display text-content-primary text-start">
                        {t('guest:saveTitle')}
                    </RNText>
                    <RNText className="text-sm text-content-secondary text-start">
                        {t('guest:saveBody')}
                    </RNText>
                </View>
                <Button
                    testID={`${TEST_ID}-sign-in`}
                    variant="secondary"
                    size="sm"
                    label={t('guest:entry.signIn')}
                    onPress={() => {
                        router.push('/sign-in');
                    }}
                />
            </View>
        </View>
    );

    /* ── the rail ───────────────────────────────────────────────────────────────────────────── */

    const placeReady =
        canPlace && basket !== undefined && !basketIsEmpty && !outOfZone && slotCode !== null;

    const summary = (
        <CheckoutCard radius="md" testID={`${TEST_ID}-rail`}>
            <View className="flex-col gap-3">
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-lg font-bold tracking-display text-content-primary text-start"
                >
                    {t('commerce:checkout.summaryTitle')}
                </RNText>

                {basket === undefined ? (
                    <View testID={`${TEST_ID}-rail-loading`} className="flex-col gap-2">
                        <Skeleton heightClassName="h-4" />
                        <Skeleton heightClassName="h-4" widthClassName="w-1/2" />
                    </View>
                ) : basketIsEmpty ? (
                    <View testID={`${TEST_ID}-rail-empty`} className="flex-col items-start gap-3">
                        <Text tone="secondary">{t('commerce:cart.emptyBody')}</Text>
                        <Button
                            testID={`${TEST_ID}-browse`}
                            variant="secondary"
                            label={t('commerce:cart.browse')}
                            onPress={() => {
                                router.push('/meals');
                            }}
                        />
                    </View>
                ) : (
                    <View className="flex-col gap-3">
                        <SummaryItems
                            testID={`${TEST_ID}-items`}
                            emphasis="strong"
                            items={basket.items.map((item) => ({
                                key: item.id,
                                name: item.name,
                                quantity: item.quantity,
                                lineTotal: item.lineTotal,
                            }))}
                        />
                        {preview.data === undefined ? (
                            <Skeleton heightClassName="h-10" />
                        ) : (
                            <View
                                testID={`${TEST_ID}-summary`}
                                className="flex-col gap-2 border-t border-stroke-subtle pt-3"
                            >
                                {preview.data.lines.map((line) => (
                                    <SummaryRow
                                        key={line.code}
                                        testID={`${TEST_ID}-summary-${line.code}`}
                                        label={priceLineLabel(t, line)}
                                        value={formatMoney(formatter, line.amount)}
                                    />
                                ))}
                                <View className="mt-1">
                                    <SummaryTotal
                                        testID={`${TEST_ID}-summary-total`}
                                        label={t('commerce:cart.total')}
                                        total={preview.data.total}
                                        labelFace="display"
                                    />
                                </View>
                            </View>
                        )}
                    </View>
                )}

                <View className="mt-1">
                    <Button
                        testID={`${TEST_ID}-place`}
                        block
                        size="lg"
                        label={t('guest:review.place')}
                        loading={place.isPending}
                        // The server's answer, not a local recomputation from the grade.
                        disabled={!placeReady}
                        onPress={() => {
                            if (!placeReady) return;
                            onPlace();
                        }}
                    />
                </View>

                {placeFailure === null ? null : (
                    <Callout
                        testID={`${TEST_ID}-place-error`}
                        role="alert"
                        tone="danger"
                        title={placeFailure.message}
                    >
                        {placeFailure.code === 'order.placement_refused'
                            ? placeFailure.reasons.map((entry) => (
                                  <RNText
                                      key={entry.reason}
                                      testID={`${TEST_ID}-place-error-reason-${entry.reason}`}
                                      className="text-xs text-content-secondary text-start"
                                  >
                                      {`• ${t(`errors:orderRefusal.${entry.reason}`, {
                                          defaultValue: entry.reason,
                                      })}`}
                                  </RNText>
                              ))
                            : null}
                    </Callout>
                )}

                {canPlace ? (
                    <RNText
                        testID={`${TEST_ID}-fine-print`}
                        className="text-xs text-content-secondary text-center"
                    >
                        {t('guest:review.finePrint')}
                    </RNText>
                ) : (
                    <RNText
                        testID={`${TEST_ID}-unverified`}
                        className="text-xs text-content-secondary text-center"
                    >
                        {t('guest:review.unverified')}
                    </RNText>
                )}
            </View>
        </CheckoutCard>
    );

    return (
        <CheckoutPage measure="wide" testID={TEST_ID}>
            <View className="flex-row flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                <CheckoutTitle size="md" testID={`${TEST_ID}-title`}>
                    {t('guest:title')}
                </CheckoutTitle>
                <Eyebrow>{t('guest:eyebrow')}</Eyebrow>
            </View>

            {sessionExpired ? (
                <Callout
                    testID={`${TEST_ID}-session-expired`}
                    role="alert"
                    tone="warning"
                    title={t('guest:session.expiredTitle')}
                    body={t('guest:session.expiredBody')}
                    actions={
                        <Button
                            testID={`${TEST_ID}-session-restart`}
                            label={t('guest:session.restart')}
                            onPress={() => {
                                // Back to card 1, basket untouched. The basket is not part of the
                                // guest session, and losing one must not look like losing the other.
                                resetContact();
                            }}
                        />
                    }
                />
            ) : null}

            <CheckoutColumns
                testID={`${TEST_ID}-layout`}
                gap="tight"
                main={blocks}
                aside={summary}
            />
        </CheckoutPage>
    );
}

/* ── one numbered card ──────────────────────────────────────────────────────────────────────── */

interface BlockProps {
    readonly number: number;
    readonly title: string;
    readonly children: ReactNode;
}

/** The design's numbered card: the filled number dot and the title, then the card's own fields. */
function Block({ number, title, children }: BlockProps) {
    const { t } = useTranslation();

    return (
        <CheckoutCard radius="md" testID={`${TEST_ID}-block-${String(number)}`}>
            <View className="mb-3 flex-row items-center gap-3">
                <NumberDot number={number} />
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    accessibilityLabel={t('guest:blockLabel', { step: number, total: 4, title })}
                    className="min-w-0 flex-1 font-display text-base font-bold tracking-display text-content-primary text-start"
                >
                    {title}
                </RNText>
            </View>
            {children}
        </CheckoutCard>
    );
}
