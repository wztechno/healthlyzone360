import {
    Button,
    Callout,
    Card,
    Checkbox,
    DateField,
    Heading,
    Inline,
    SegmentedControl,
    Stack,
    Stepper,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { AddressForm } from '../../commerce/address-form.tsx';
import {
    EMPTY_ADDRESS,
    formatAddress,
    toDeliveryAddress,
    validateAddress,
} from '../../commerce/address.ts';
import type { AddressField, AddressValues } from '../../commerce/address.ts';
import { earliestStartDate } from '../../commerce/dates.ts';
import {
    DEFAULT_SLOT_CODE,
    DELIVERY_SLOTS,
    deliveryAreaStatus,
    servedAreas,
} from '../../commerce/delivery.ts';
import { PriceSummary } from '../../commerce/price-summary.tsx';
import type { PriceRow } from '../../commerce/price-summary.tsx';
import { EMPTY_GUEST_CONTACT, toContactRequest, validateGuestContact } from '../contact.ts';
import type { GuestContactField, GuestContactValues } from '../contact.ts';
import { GuestChallenge } from '../guest-challenge.tsx';
import { GuestContactForm } from '../guest-contact-form.tsx';

/**
 * `/guest-checkout` — ordering without an account.
 *
 * Four steps, in the order the person's own questions arrive: **who are you**, **where is it
 * going**, **prove we can reach you**, **is this right**. Each decision that could waste somebody's
 * time is taken as early as it honestly can be.
 *
 * ## The out-of-zone check is a hard stop, and it happens at the address step
 *
 * Doc 17 `SUB-02` records the deliberate divergence from the reference product: ask about delivery
 * *before* the price, not after. So the area is checked against the kitchen's own published
 * delivery zones the moment it is typed, and `unserved` blocks the step — there is no "continue
 * anyway", because continuing leads to a passcode, a review screen and a placed order for food that
 * cannot be delivered. `unknown` is a real third answer and is **not** treated as a refusal: a
 * kitchen that publishes no zones has told us nothing, and blocking on silence would turn a gap in
 * the catalogue into a person being turned away.
 *
 * ## Verification gates placing, not browsing
 *
 * The passcode step exists because an order is a promise that somebody will be told when it is
 * late, and a destination nobody proved is a promise made to a typo. Until the session reaches
 * `place_order`, the review step's button is disabled and says why. The client never *decides* the
 * gate — it reads `capabilities` from the session, which is the server's answer.
 *
 * ## Marketing is off, and "off" is sent
 *
 * The checkbox starts unticked and its value is sent explicitly on the draft. An opt-in that
 * arrives absent is one somebody has to interpret, and "they left it alone" must never be
 * distinguishable from "they said no".
 *
 * ## A timed-out session returns to step one with the basket intact
 *
 * Guest sessions are deliberately short. When the token stops resolving — expired, revoked, cleared
 * by another tab — this screen does not show an error page: it goes back to the contact step,
 * says plainly what happened, and leaves the basket alone. The basket is not part of the guest
 * session; losing the session must not look like losing the order.
 *
 * ## No payment fields, and nowhere for one to go
 *
 * There is one payment method, it is cash on delivery, and it is a one-member type in the contract
 * (`contracts/guest.ts`). A guest has nowhere for a stored instrument to live, and a checkout that
 * *could* carry a card is one somebody eventually wires to a gateway.
 */

const TEST_ID = 'guest-checkout';

const STEPS = ['contact', 'address', 'verify', 'review'] as const;
type Step = (typeof STEPS)[number];

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

    const [step, setStep] = useState<Step>('contact');
    const [contact, setContact] = useState<GuestContactValues>(EMPTY_GUEST_CONTACT);
    const [address, setAddress] = useState<AddressValues>(EMPTY_ADDRESS);
    const [slotCode, setSlotCode] = useState(DEFAULT_SLOT_CODE);
    const [deliveryDate, setDeliveryDate] = useState<string>(() => earliestStartDate());
    // Off unless turned on, and sent either way. See the header.
    const [marketingOptIn, setMarketingOptIn] = useState(false);
    const [showErrors, setShowErrors] = useState(false);
    const [challengeId, setChallengeId] = useState<string | null>(null);

    /**
     * The session has died mid-checkout.
     *
     * Read from the *query*, not from the token: a token can still be in the store while the server
     * has already stopped honouring it, and that is the case this recovery exists for.
     */
    const sessionFailure = toFailure(session.error);
    const sessionExpired =
        sessionFailure !== null && sessionFailure.code === 'auth.unauthenticated';

    const contactErrors = useMemo(
        () => validateGuestContact(contact, validationTranslate),
        [contact, validationTranslate],
    );
    const addressErrors = useMemo(
        () => validateAddress(address, validationTranslate),
        [address, validationTranslate],
    );

    /** The kitchen the basket is from — the only source of a real delivery-zone answer. */
    const kitchenId = basket?.items[0]?.kitchenId ?? null;
    const kitchen = useKitchenQuery(kitchenId);
    const areaStatus = deliveryAreaStatus(kitchen.data, address.area);
    const outOfZone = areaStatus === 'unserved';

    const preview = useCheckoutPreviewQuery(
        basket === undefined || basket.items.length === 0 ? null : { cartId: basket.id },
    );

    const capabilities = session.data?.capabilities ?? [];
    const canPlace = capabilities.includes('place_order');

    const rows: readonly PriceRow[] =
        preview.data === undefined
            ? []
            : [
                  ...preview.data.lines.map((line) => ({
                      key: line.code,
                      label: line.label,
                      amount: line.amount,
                  })),
                  { key: 'total', label: t('guest:order.total'), amount: preview.data.total },
              ];

    /* ── step one: who are you ──────────────────────────────────────────────────────────────── */

    const onContinueFromContact = () => {
        setShowErrors(true);
        if (Object.keys(contactErrors).length > 0) return;

        const request = toContactRequest(contact);
        const withSession = () => {
            updateContact.mutate(request, {
                onSuccess: (result) => {
                    setChallengeId(result.challenge?.id ?? null);
                    setShowErrors(false);
                    setStep('address');
                },
            });
        };

        // A session is started lazily, here, rather than on mount: a person browsing the checkout
        // and leaving should not have a credential minted for them, and a provisional account
        // created for every page view is a purge job's problem for no benefit.
        if (token === null || sessionExpired) start.mutate(undefined, { onSuccess: withSession });
        else withSession();
    };

    /* ── rendering ──────────────────────────────────────────────────────────────────────────── */

    const stepIndex = STEPS.indexOf(step) + 1;

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('guest:title')}
                </Heading>
                <Text tone="secondary">{t('guest:subtitle')}</Text>
            </Stack>

            <Stepper
                testID={`${TEST_ID}-progress`}
                label={t('guest:title')}
                current={stepIndex}
                total={STEPS.length}
                stepLabel={t(`guest:steps.${step}`)}
            />

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
                                // Back to step one, basket untouched. The basket is not part of the
                                // guest session, and losing one must not look like losing the other.
                                setStep('contact');
                                setChallengeId(null);
                            }}
                        />
                    }
                />
            ) : null}

            {step === 'contact' ? (
                <Card padding="md" testID={`${TEST_ID}-contact-step`}>
                    <Stack space="md">
                        <Stack space="xs">
                            <Heading level={2}>{t('guest:contact.title')}</Heading>
                            <Text tone="secondary">{t('guest:contact.subtitle')}</Text>
                        </Stack>

                        <GuestContactForm
                            testID={`${TEST_ID}-contact`}
                            values={contact}
                            errors={showErrors ? contactErrors : {}}
                            onChange={(field: GuestContactField, value: string) => {
                                setContact((current) => ({ ...current, [field]: value }));
                            }}
                            disabled={updateContact.isPending || start.isPending}
                        />

                        <Button
                            testID={`${TEST_ID}-contact-continue`}
                            label={t('guest:contact.continue')}
                            loading={updateContact.isPending || start.isPending}
                            onPress={onContinueFromContact}
                        />

                        <Inline space="sm" align="center">
                            <Text tone="secondary" variant="caption">
                                {t('guest:entry.body')}
                            </Text>
                            <Button
                                testID={`${TEST_ID}-sign-in`}
                                variant="ghost"
                                label={t('guest:entry.signIn')}
                                onPress={() => {
                                    router.push('/sign-in');
                                }}
                            />
                        </Inline>
                    </Stack>
                </Card>
            ) : null}

            {step === 'address' ? (
                <Card padding="md" testID={`${TEST_ID}-address-step`}>
                    <Stack space="md">
                        <Stack space="xs">
                            <Heading level={2}>{t('guest:address.title')}</Heading>
                            <Text tone="secondary">{t('guest:address.subtitle')}</Text>
                        </Stack>

                        <AddressForm
                            testID={`${TEST_ID}-address`}
                            values={address}
                            errors={showErrors ? addressErrors : {}}
                            onChange={(field: AddressField, value: string) => {
                                setAddress((current) => ({ ...current, [field]: value }));
                            }}
                        />

                        {outOfZone ? (
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
                        ) : null}

                        <SegmentedControl
                            testID={`${TEST_ID}-slot`}
                            label={t('guest:address.slot')}
                            block
                            items={DELIVERY_SLOTS.map((slot) => ({
                                value: slot.code,
                                label: t(`commerce:slots.${slot.code}`),
                            }))}
                            value={slotCode}
                            onChange={setSlotCode}
                        />

                        <DateField
                            testID={`${TEST_ID}-date`}
                            label={t('guest:address.date')}
                            value={deliveryDate}
                            onChange={(next: string | null) => {
                                setDeliveryDate(next ?? earliestStartDate());
                            }}
                        />

                        <Inline space="sm">
                            <Button
                                testID={`${TEST_ID}-address-continue`}
                                label={t('guest:address.continue')}
                                // The hard stop. There is no "continue anyway" and there must not be.
                                disabled={outOfZone}
                                onPress={() => {
                                    setShowErrors(true);
                                    if (Object.keys(addressErrors).length > 0) return;
                                    if (outOfZone) return;
                                    setShowErrors(false);
                                    setStep('verify');
                                }}
                            />
                            <Button
                                testID={`${TEST_ID}-address-back`}
                                variant="ghost"
                                label={t('guest:address.back')}
                                onPress={() => {
                                    setStep('contact');
                                }}
                            />
                        </Inline>
                    </Stack>
                </Card>
            ) : null}

            {step === 'verify' ? (
                <Card padding="md" testID={`${TEST_ID}-verify-step`}>
                    <Stack space="md">
                        <Stack space="xs">
                            <Heading level={2}>{t('guest:verify.title')}</Heading>
                            <Text tone="secondary">
                                {t('guest:verify.subtitle', {
                                    // The server's mask when there is one. The typed value only
                                    // ever stands in for the first frame after a resend, and it is
                                    // never masked here — the client does not do its own masking.
                                    destination:
                                        session.data?.contact?.maskedDestination ??
                                        (contact.email.trim().length > 0
                                            ? contact.email
                                            : contact.mobile),
                                })}
                            </Text>
                        </Stack>

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
                                                setStep('review');
                                            },
                                        },
                                    );
                                }}
                            />
                        )}

                        <Button
                            testID={`${TEST_ID}-verify-back`}
                            variant="ghost"
                            label={t('guest:verify.back')}
                            onPress={() => {
                                setStep('contact');
                            }}
                        />
                    </Stack>
                </Card>
            ) : null}

            {step === 'review' ? (
                <Card padding="md" testID={`${TEST_ID}-review-step`}>
                    <Stack space="md">
                        <Stack space="xs">
                            <Heading level={2}>{t('guest:review.title')}</Heading>
                            <Text tone="secondary">{t('guest:review.subtitle')}</Text>
                        </Stack>

                        <Stack space="xs" testID={`${TEST_ID}-review-delivery`}>
                            <Text variant="bodyStrong">{t('guest:review.deliveringTo')}</Text>
                            <Text tone="secondary">
                                {formatAddress(toDeliveryAddress(address))}
                            </Text>
                            <Text variant="bodyStrong">{t('guest:review.slot')}</Text>
                            <Text tone="secondary">
                                {`${formatter.formatDate(deliveryDate)} · ${t(`commerce:slots.${slotCode}`)}`}
                            </Text>
                            <Text variant="bodyStrong">{t('guest:review.contact')}</Text>
                            <Text tone="secondary" testID={`${TEST_ID}-review-contact`}>
                                {session.data?.contact?.maskedDestination ?? ''}
                            </Text>
                        </Stack>

                        <PriceSummary testID={`${TEST_ID}-summary`} rows={rows} />

                        <Stack space="xs" testID={`${TEST_ID}-payment`}>
                            <Text variant="bodyStrong">{t('guest:review.payment')}</Text>
                            <Text>{t('guest:review.cashOnDelivery')}</Text>
                            <Text tone="secondary" variant="caption">
                                {t('guest:review.cashOnDeliveryNote')}
                            </Text>
                        </Stack>

                        <Checkbox
                            testID={`${TEST_ID}-marketing`}
                            label={t('guest:review.marketingLabel')}
                            description={t('guest:review.marketingHint')}
                            checked={marketingOptIn}
                            onChange={setMarketingOptIn}
                        />

                        {canPlace ? null : (
                            <Callout
                                testID={`${TEST_ID}-unverified`}
                                role="alert"
                                tone="warning"
                                title={t('guest:review.unverified')}
                            />
                        )}

                        {toFailure(place.error) === null ? null : (
                            <Callout
                                testID={`${TEST_ID}-place-error`}
                                role="alert"
                                tone="danger"
                                title={toFailure(place.error)?.message ?? ''}
                            />
                        )}

                        <Inline space="sm">
                            <Button
                                testID={`${TEST_ID}-place`}
                                label={t('guest:review.place')}
                                loading={place.isPending}
                                // The server's answer, not a local recomputation from the grade.
                                disabled={!canPlace || basket === undefined}
                                onPress={() => {
                                    if (basket === undefined) return;
                                    place.mutate(
                                        {
                                            cartId: basket.id,
                                            address: toDeliveryAddress(address),
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
                                }}
                            />
                            <Button
                                testID={`${TEST_ID}-review-back`}
                                variant="ghost"
                                label={t('guest:review.back')}
                                onPress={() => {
                                    setStep('address');
                                }}
                            />
                        </Inline>
                    </Stack>
                </Card>
            ) : null}
        </Stack>
    );
}
