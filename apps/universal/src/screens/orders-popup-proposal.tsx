import { Icon, Text } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { View } from 'react-native';

import { CompactRecordPopup } from '../features/kitchen-admin/catalogue/compact-record-popup.tsx';
import { DeskButton, DeskChip } from '../features/kitchen-admin/desk-kit/index.ts';
import { InfoCard, StageTrack } from '../features/kitchen-admin/orders/order-popup-parts.tsx';
import type { OrderStage } from '../features/kitchen-admin/orders/order-popup-parts.tsx';

/**
 * Layout B of the order pop-up (proposed 2026-11-10, chosen 2026-11-11) with sample data — the app
 * draws the same parts (`orders/order-popup-parts.tsx`) in `OrderRecordPopup`.
 *
 * ```
 * ┌───────────────────────────────────────────────────────────────────────────────┐
 * │ [‹ 2 of 4 ›]  DELIVERY ORDER  ORD-…   (Confirmed)(Late)            $16.00  ✕  │
 * ├───────────────────────────────────────────────────────────────────────────────┤
 * │ ✓ Placed ── ✓ Confirmed ── ● Ready ── ○ On the way ── ○ Delivered  [Next ▸] │  where it is, what next
 * ├───────────────────────────────────────────────────────────────────────────────┤
 * │ ┌ CUSTOMER ──────┐ ┌ DELIVERY ───────────┐ ┌ MONEY ───────────────┐          │  three cards: who,
 * │ │ Karim Saleh    │ │ Today · Lunch        │ │ To collect  $16.00   │          │  when/where, money —
 * │ │ +961 71 552 019│ │ Achrafieh, Bldg 12   │ │ Cash on delivery     │          │  each with its one
 * │ │ [Call]         │ │ Driver: needs one    │ │ [Record a payment]   │          │  action
 * │ └────────────────┘ └──────────────────────┘ └──────────────────────┘          │
 * │ ⚠ Allergy: peanuts (severe)   ✎ Note: ring twice                              │  what the kitchen must not miss
 * │ ITEMS                                                                         │
 * │ (2) Grilled Salmon Bowl · No onions                              $16.00       │
 * │ ─────────────────────────────────────── Subtotal / Delivery / Total           │
 * └───────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * What changes against the pop-up in use: the line of loose facts becomes a progress track that
 * says where the order is and puts the next step at its end; who / when-where / money are three
 * cards of equal weight, each with its own one action, instead of a side column of mixed fields;
 * allergies and the kitchen note are lifted out of the items into one warning row; and the items
 * end in their totals, like the ticket.
 */

export type ProposalStage = OrderStage;

export interface ProposalLine {
    readonly key: string;
    readonly quantity: number;
    readonly name: string;
    readonly detail?: string | undefined;
    readonly amount: string;
}

export function OrderPopupProposal({
    onClose,
    stages,
    lines,
}: {
    readonly onClose: () => void;
    readonly stages: readonly ProposalStage[];
    readonly lines: readonly ProposalLine[];
}) {
    return (
        <CompactRecordPopup
            testID="showcase-orders-popup-b"
            label="Order ORD-SHOW000002"
            kind="Delivery order"
            title="ORD-SHOW000002"
            nav={{ position: '2 of 4', onPrevious: () => undefined, onNext: () => undefined }}
            chips={
                <>
                    <DeskChip tone="info" label="Confirmed" />
                    <DeskChip tone="danger" label="Late" />
                </>
            }
            figure={{ label: 'Total', value: '$16.00' }}
            banner={
                <View className="flex-col gap-3">
                    <StageTrack
                        label="Where the order is"
                        stages={stages}
                        next={<DeskButton label="Mark delivered" />}
                    />
                    <View className="flex-row flex-wrap gap-3">
                        <InfoCard
                            icon="person"
                            title="Customer"
                            action={<DeskButton variant="quiet" label="Call" />}
                        >
                            <Text variant="strong">Karim Saleh</Text>
                            <Text variant="caption" tone="secondary" className="tabular-nums">
                                +961 71 552 019
                            </Text>
                        </InfoCard>
                        <InfoCard
                            icon="truck"
                            title="Delivery"
                            action={<DeskButton variant="quiet" label="Change driver" />}
                        >
                            <Text variant="strong">Today · Lunch, 12:00–14:00</Text>
                            <Text variant="caption" tone="secondary">
                                Achrafieh, Building 12, 3rd floor
                            </Text>
                            <Text variant="caption" tone="secondary">
                                Driver: Hadi Rizk
                            </Text>
                        </InfoCard>
                        <InfoCard
                            icon="banknote"
                            title="Money"
                            action={<DeskButton variant="quiet" label="Record a payment" />}
                            warn
                        >
                            <Text variant="strong" tone="warning">
                                To collect $16.00
                            </Text>
                            <Text variant="caption" tone="secondary">
                                Cash on delivery
                            </Text>
                        </InfoCard>
                    </View>
                    <View className="flex-row flex-wrap gap-2">
                        <Flag icon="warning" tone="warning" text="Allergy: peanuts (severe)" />
                        <Flag icon="pen" tone="neutral" text="Note: ring twice, blue gate" />
                    </View>
                </View>
            }
            main={
                <View className="flex-col gap-1">
                    <Text
                        variant="micro"
                        tone="secondary"
                        className="font-bold uppercase tracking-wider"
                    >
                        Items
                    </Text>
                    {lines.map((line) => (
                        <View
                            key={line.key}
                            className="flex-row items-center gap-3 border-b border-stroke-subtle py-2"
                        >
                            <View className="h-6 min-w-6 items-center justify-center rounded-full bg-surface-brand-subtle px-1.5">
                                <Text
                                    variant="caption"
                                    className="font-bold tabular-nums !text-content-on-brand-subtle"
                                >
                                    {String(line.quantity)}
                                </Text>
                            </View>
                            <View className="min-w-0 flex-1 flex-col">
                                <Text variant="strong" numberOfLines={1}>
                                    {line.name}
                                </Text>
                                {line.detail === undefined ? null : (
                                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                                        {line.detail}
                                    </Text>
                                )}
                            </View>
                            <Text variant="strong" className="tabular-nums">
                                {line.amount}
                            </Text>
                        </View>
                    ))}
                    <View className="min-w-[220px] flex-col gap-1 self-end pt-2">
                        <Total label="Subtotal" value="$13.00" />
                        <Total label="Delivery" value="$3.00" />
                        <Total label="Total" value="$16.00" strong />
                    </View>
                </View>
            }
            footer={
                <>
                    <DeskButton variant="secondary" label="Print ticket" />
                    <DeskButton variant="secondary" label="Edit order" />
                </>
            }
            footerEnd={<DeskButton variant="dangerOutline" label="Cancel order" />}
            onClose={onClose}
        />
    );
}

function Flag({
    icon,
    tone,
    text,
}: {
    readonly icon: IconName;
    readonly tone: 'warning' | 'neutral';
    readonly text: string;
}) {
    return (
        <View
            className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 ${
                tone === 'warning' ? 'bg-warning-subtle' : 'bg-surface-sunken'
            }`}
        >
            <Icon
                name={icon}
                size="sm"
                className={tone === 'warning' ? 'text-warning-on-subtle' : 'text-content-secondary'}
            />
            <Text
                variant="label"
                className={tone === 'warning' ? '!font-semibold !text-warning-on-subtle' : ''}
            >
                {text}
            </Text>
        </View>
    );
}

function Total({
    label,
    value,
    strong = false,
}: {
    readonly label: string;
    readonly value: string;
    readonly strong?: boolean;
}) {
    return (
        <View className="flex-row items-center justify-between gap-6">
            <Text variant={strong ? 'strong' : 'label'} tone={strong ? 'primary' : 'secondary'}>
                {label}
            </Text>
            <Text
                variant={strong ? 'strong' : 'label'}
                tone={strong ? 'brand' : 'primary'}
                className="tabular-nums"
            >
                {value}
            </Text>
        </View>
    );
}
