import type { PlacedOrder, SubscriptionPreview } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Eyebrow } from '../../ui/eyebrow.tsx';
import { formatMoney } from '../marketplace/format.ts';
import { SummaryItems, SummaryRow, SummaryTotal, priceLineLabel } from './checkout-frame.tsx';

/**
 * What the receipt printer prints: the checkout rail's own rows, set on a paper slip.
 *
 * Every figure is the server's — the placed order's lines and total, or the subscription preview's
 * — and goes through `formatMoney`. Nothing is added up here, for the reason `SummaryTotal` gives.
 */

/** The dashed tear-line a till prints between sections. */
function Perforation() {
    return <View aria-hidden className="my-4 border-t border-dashed border-stroke-strong" />;
}

function ReceiptHead({
    title,
    detail,
    testID,
}: {
    readonly title: string;
    readonly detail: string | null;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    return (
        <View className="flex-col items-center gap-1">
            <Eyebrow>{t('commerce:receipt.title')}</Eyebrow>
            <RNText
                testID={`${testID}-title`}
                className="font-display text-xl font-bold tracking-display text-content-primary text-center"
            >
                {title}
            </RNText>
            {detail === null ? null : (
                <RNText
                    testID={`${testID}-detail`}
                    className="text-sm tabular-nums text-content-secondary text-center"
                >
                    {detail}
                </RNText>
            )}
        </View>
    );
}

function ReceiptFoot({ children }: { readonly children: string }) {
    return (
        <View className="mt-5 items-center">
            <Eyebrow>{children}</Eyebrow>
        </View>
    );
}

function Rows({ children }: { readonly children: ReactNode }) {
    return <View className="flex-col gap-2.5">{children}</View>;
}

export interface MealReceiptProps {
    readonly order: PlacedOrder;
    readonly kitchenName: string | null;
    /** "Midday on 13 Aug 2026" — the committed window, already worded. */
    readonly arriving: string;
    readonly testID: string;
}

export function MealReceipt({ order, kitchenName, arriving, testID }: MealReceiptProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View testID={testID} className="flex-col">
            <ReceiptHead
                testID={testID}
                title={kitchenName ?? t('commerce:checkout.theKitchen')}
                detail={t('commerce:receipt.reference', { reference: order.reference })}
            />
            <Perforation />
            <Rows>
                <SummaryRow
                    testID={`${testID}-delivery`}
                    label={t('commerce:receipt.delivery')}
                    value={arriving}
                />
                <SummaryRow
                    testID={`${testID}-placed`}
                    label={t('commerce:receipt.placed')}
                    value={formatter.formatDate(order.placedAt, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                    })}
                />
                <SummaryRow
                    testID={`${testID}-payment`}
                    label={t('commerce:receipt.payment')}
                    value={t('commerce:checkout.paymentCod')}
                />
            </Rows>
            <Perforation />
            <SummaryItems
                testID={`${testID}-items`}
                items={order.lines.map((line) => ({
                    key: line.id,
                    name: line.name,
                    quantity: line.quantity,
                    lineTotal: line.lineTotal,
                }))}
            />
            <Perforation />
            {order.priceLines.length === 0 ? null : (
                <View className="mb-4">
                    <Rows>
                        {order.priceLines.map((line) => (
                            <SummaryRow
                                key={line.code}
                                testID={`${testID}-price-${line.code}`}
                                label={priceLineLabel(t, line)}
                                value={formatMoney(formatter, line.amount)}
                            />
                        ))}
                    </Rows>
                </View>
            )}
            <SummaryTotal
                testID={`${testID}-total`}
                label={t('commerce:cart.total')}
                total={order.total}
            />
            <ReceiptFoot>{t('commerce:receipt.thanks')}</ReceiptFoot>
        </View>
    );
}

export interface PlanReceiptProps {
    readonly planName: string;
    readonly preview: SubscriptionPreview;
    readonly testID: string;
}

export function PlanReceipt({ planName, preview, testID }: PlanReceiptProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const day = (date: string) => formatter.formatDate(date, { dateStyle: 'medium' });

    return (
        <View testID={testID} className="flex-col">
            <ReceiptHead testID={testID} title={planName} detail={null} />
            <Perforation />
            <Rows>
                <SummaryRow
                    testID={`${testID}-starts`}
                    label={t('commerce:receipt.starts')}
                    value={day(preview.firstDeliveryDate)}
                />
                <SummaryRow
                    testID={`${testID}-ends`}
                    label={t('commerce:receipt.ends')}
                    value={day(preview.lastDeliveryDate)}
                />
                <SummaryRow
                    testID={`${testID}-deliveries`}
                    label={t('commerce:receipt.deliveries')}
                    value={formatter.formatNumber(preview.deliveryCount)}
                />
            </Rows>
            <Perforation />
            <View className="mb-4">
                <Rows>
                    {preview.lines.map((line) => (
                        <SummaryRow
                            key={line.code}
                            testID={`${testID}-price-${line.code}`}
                            label={priceLineLabel(t, line)}
                            value={formatMoney(formatter, line.amount)}
                        />
                    ))}
                </Rows>
            </View>
            <SummaryTotal
                testID={`${testID}-total`}
                label={t('commerce:cart.total')}
                total={preview.total}
                rule
            />
            <ReceiptFoot>{t('commerce:receipt.thanks')}</ReceiptFoot>
        </View>
    );
}
