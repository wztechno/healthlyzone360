import { apiFailure } from '@healthy360/api-client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { ExtraNote } from '../features/account/account-extra.tsx';
import { PlanReceipt } from '../features/commerce/price-summary.tsx';
import { OrderTracking } from '../features/orders/order-tracking.tsx';
import type { TrackableOrder } from '../features/orders/order-tracking.tsx';
import { OtpChallengePanel } from '../features/verification/otp-challenge-panel.tsx';
import type { OtpChallengeView } from '../features/verification/otp-challenge-panel.tsx';
import { CodeBoxes } from '../ui/code-boxes.tsx';
import {
    ShopDialog,
    ShopDialogButton,
    ShopDialogConsequence,
    ShopDialogDateTile,
    ShopDialogSubject,
    ShopDialogTag,
    ShopDialogTile,
} from '../ui/shop-dialog.tsx';
import type { ShopDialogTone } from '../ui/shop-dialog.tsx';
import {
    ShopCardSkeletons,
    ShopFiguresSkeleton,
    ShopFormSkeleton,
    ShopKitchenSkeletons,
    ShopLinesSkeleton,
    ShopPageSkeleton,
    ShopPlanSkeletons,
    ShopRowSkeletons,
} from '../ui/shop-skeletons.tsx';
import { ShopErrorCard, ShopStateButton, ShopStateCard } from '../ui/shop-state.tsx';
import { ShopSwitch } from '../ui/shop-switch.tsx';

/**
 * `/showcase-shop` — the web shop's own parts, on a page of their own: the code boxes every
 * one-time code is typed into, in each state, the code panel as the sign-in frame draws it, the
 * boards' notes, the shop's switch, its pop-up in each tone, and its empty, error and loading
 * states. Development only.
 */

/** A cancelled guest order — the Orders boards' pins 1–3 without a backend. */
const SAMPLE_ORDER: TrackableOrder = {
    reference: 'ORD-K7Q2M9XD4P',
    state: 'cancelled',
    lines: [
        {
            id: 'showcase-line',
            name: 'Grilled halloumi bowl',
            quantity: 1,
            lineTotal: { amount: 2300, currency: 'USD' },
        },
    ],
    total: { amount: 2300, currency: 'USD' },
    address: {
        label: 'Home',
        line1: 'Hamra street',
        line2: null,
        area: 'Aatchaneh',
        city: 'Beirut',
        countryCode: 'LB',
        instructions: null,
    },
    slotCode: '',
    deliveryDate: '',
    placedAt: new Date().toISOString(),
};

/** A challenge as the server would describe one — enough to draw the panel without a backend. */
const SAMPLE_CHALLENGE: OtpChallengeView = {
    id: 'showcase',
    channel: 'sms',
    maskedDestination: '+971 50 ••• 4567',
    codeLength: 6,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    resendCooldownSeconds: 42,
    attemptsRemaining: 3,
    availableChannels: ['sms', 'whatsapp', 'email'],
    simulatedChannels: ['email'],
};

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <View className="flex-col gap-4 rounded-3xl border border-stroke-subtle bg-surface-raised p-6">
            <RNText className="text-lg font-bold text-content-primary text-start">{title}</RNText>
            {children}
        </View>
    );
}

function Labelled({ label, children }: { readonly label: string; readonly children: ReactNode }) {
    return (
        <View className="flex-col gap-2">
            <RNText className="text-sm font-semibold text-content-secondary text-start">
                {label}
            </RNText>
            {children}
        </View>
    );
}

export function ShopPartsShowcaseScreen() {
    const [code, setCode] = useState('');
    const [on, setOn] = useState(true);
    const [off, setOff] = useState(false);
    const [dialog, setDialog] = useState<ShopDialogTone | null>(null);
    const close = () => {
        setDialog(null);
    };

    return (
        <View
            testID="shop-parts-showcase"
            className="w-full max-w-[880px] flex-col gap-6 self-center py-8"
        >
            <Section title="Code boxes">
                <Labelled label="Type here — the focused box blinks, digits pop in">
                    <CodeBoxes label="Code" length={6} value={code} onChangeText={setCode} />
                </Labelled>
                <Labelled label="Part typed">
                    <CodeBoxes label="Code" length={6} value="528" onChangeText={() => undefined} />
                </Labelled>
                <Labelled label="Wrong code">
                    <CodeBoxes
                        label="Code"
                        length={6}
                        value="528061"
                        error="That code is not right. Check it and try again."
                        onChangeText={() => undefined}
                    />
                </Labelled>
                <Labelled label="Large, on an account card">
                    <CodeBoxes
                        label="Code"
                        length={6}
                        size="lg"
                        align="start"
                        value="5280"
                        onChangeText={() => undefined}
                    />
                </Labelled>
            </Section>
            <Section title="Code panel — sign-in frame look (/verify-phone)">
                <View className="w-full max-w-[420px] self-center">
                    <OtpChallengePanel
                        look="auth"
                        testID="showcase-otp"
                        challenge={SAMPLE_CHALLENGE}
                        onVerify={() => undefined}
                        onResend={() => undefined}
                    />
                </View>
            </Section>
            <Section title="Board notes">
                <ExtraNote icon="send" title="Check n••••@example.com" body="A neutral note." />
                <ExtraNote tone="ok" icon="check" title="Saved" body="News in the brand's green." />
                <ExtraNote tone="amber" icon="clock" title="Wait a moment" body="A caution." />
                <ExtraNote tone="bad" icon="warning" title="This cannot be undone" body="Danger." />
            </Section>
            <Section title="Pop-up — brand, warning, danger (phones get a bottom sheet)">
                <View className="flex-row flex-wrap gap-2">
                    {(['brand', 'warning', 'danger'] as const).map((tone) => (
                        <ShopStateButton
                            key={tone}
                            testID={`showcase-dialog-open-${tone}`}
                            kind="secondary"
                            label={tone}
                            onPress={() => {
                                setDialog(tone);
                            }}
                        />
                    ))}
                </View>
                <ShopDialog
                    testID="showcase-dialog"
                    open={dialog !== null}
                    onClose={close}
                    tone={dialog ?? 'brand'}
                    icon={
                        dialog === 'danger'
                            ? 'trash'
                            : dialog === 'warning'
                              ? 'alert'
                              : 'skipForward'
                    }
                    title="Skip this delivery?"
                    description="The delivery on Saturday 7 November 2026 will not be made."
                    actions={
                        <>
                            <ShopDialogButton label="Cancel" onPress={close} />
                            <ShopDialogButton
                                kind={
                                    dialog === 'danger'
                                        ? 'danger'
                                        : dialog === 'warning'
                                          ? 'ink'
                                          : 'brand'
                                }
                                icon="skipForward"
                                label="Skip this delivery"
                                onPress={close}
                            />
                        </>
                    }
                >
                    <ShopDialogSubject
                        lead={<ShopDialogDateTile weekday="Sat" day="7" />}
                        name="Saturday 7 November 2026"
                        meta="Weekday Lean · Lunch 12:00–15:00 · Home"
                    />
                    <View className="mt-2">
                        <ShopDialogSubject
                            lead={<ShopDialogTile icon="leaf" />}
                            name="Weekday Lean"
                            tag={<ShopDialogTag label="Paused" tone="warning" />}
                            meta="HealthZone360 Kitchen · 27 days left"
                        />
                    </View>
                    <ShopDialogConsequence
                        icon="calendar"
                        title="What happens next"
                        body="That day is removed from the schedule."
                    />
                </ShopDialog>
            </Section>
            <Section title="States — empty, small, error, loading">
                <ShopStateCard
                    icon="searchLens"
                    title="Nothing matches those filters"
                    body="Try widening the calorie range or clearing a dietary filter."
                    actions={
                        <ShopStateButton
                            kind="secondary"
                            label="Clear filters"
                            onPress={() => undefined}
                        />
                    }
                />
                <ShopStateCard
                    small
                    icon="receipt"
                    title="No orders yet"
                    body="Orders you place while signed in appear here, newest first."
                    actions={
                        <ShopStateButton
                            icon="arrowForward"
                            iconAfter
                            label="Browse the menu"
                            onPress={() => undefined}
                        />
                    }
                />
                <ShopErrorCard
                    failure={apiFailure('server', {
                        correlationId: 'req_8f2a91c4',
                        retryable: true,
                    })}
                    onRetry={() => undefined}
                />
            </Section>
            <Section title="Loading shapes (one look: hairline blocks, shimmer)">
                <ShopCardSkeletons count={4} testID="showcase-skeletons" />
                <ShopPlanSkeletons count={3} testID="showcase-skeletons-plans" />
                <ShopKitchenSkeletons count={3} testID="showcase-skeletons-kitchens" />
                <ShopRowSkeletons count={3} testID="showcase-skeletons-rows" />
                <ShopLinesSkeleton testID="showcase-skeletons-lines" />
                <ShopFormSkeleton testID="showcase-skeletons-form" />
                <ShopFiguresSkeleton count={4} testID="showcase-skeletons-figures" />
                <ShopPageSkeleton testID="showcase-skeletons-page" />
            </Section>
            <Section title="Plan price as a receipt (plan setup, review)">
                <PlanReceipt
                    testID="showcase-receipt"
                    perDayList={{ amount: 2000, currency: 'USD' }}
                    deliveryCount={20}
                    gross={{ amount: 40000, currency: 'USD' }}
                    discount={{ percent: 5, amount: { amount: -2000, currency: 'USD' } }}
                    total={{ amount: 38000, currency: 'USD' }}
                    perDelivery={{ amount: 1900, currency: 'USD' }}
                />
            </Section>
            <Section title="Order page — guest reference chip, cancelled card and stopped timeline">
                <OrderTracking
                    testID="showcase-order"
                    order={SAMPLE_ORDER}
                    paymentLabel="Cash on delivery"
                    showReference
                />
            </Section>
            <Section title="Switch">
                <View className="flex-row items-center gap-6">
                    <ShopSwitch label="On" checked={on} onChange={setOn} />
                    <ShopSwitch label="Off" checked={off} onChange={setOff} />
                    <ShopSwitch label="Disabled" checked disabled onChange={() => undefined} />
                </View>
            </Section>
        </View>
    );
}
