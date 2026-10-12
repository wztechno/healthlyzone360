import { isConflictFailure } from '@healthy360/api-client/contracts';
import type {
    ItemChannelOffer,
    ItemChannelPrices,
    SetItemChannelOffer,
    SetItemChannelPricesRequest,
    TradeChannel,
} from '@healthy360/api-client/contracts';
import {
    Button,
    FormSection,
    QuantityInput,
    Select,
    Stack,
    Text,
    parseQuantity,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { minorUnitExponent } from '@healthy360/domain-types';
import type { MealId, ProductId } from '@healthy360/domain-types';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCan } from '../../access/gate.tsx';
import { toFailure } from '../../data/hooks.ts';
import {
    useItemChannelPricesQuery,
    useSetItemChannelPricesMutation,
} from '../../data/kitchen-admin-hooks.ts';
import {
    CATALOGUE_MANAGE_PERMISSION,
    PRICE_LIST_MANAGE_PERMISSION,
    PRICE_LIST_VIEW_PERMISSION,
} from './entity-registry.ts';
import { parseAmount, unitShortKey } from './format.ts';

/**
 * B2B and B2C — the weight each channel sells and its price, side by side, the way the v6 sheet
 * states them (B2B Weight, B2B Price, B2C Weight, B2C Price).
 *
 * ```
 * B2B and B2C                                                   [ Save prices ]
 *          Weight        Unit      Price
 *   B2B    [ 1      ]    [ kg ]    [ 12.00  USD ]
 *   B2C    [ 0.2    ]    [ kg ]    [ 3.00   USD ]
 * ```
 *
 * Its own save, because it is its own write: the packs and the prices land together through
 * `PUT /catalogue/items/{item}/channel-prices`, which needs the price-list permission as well as the
 * catalogue one. The host form's Save never touches it, and it never touches the host form.
 *
 * A row with a weight and no price keeps the pack and withdraws its price — sized, not sold. A row
 * cleared entirely stops selling on that channel. A channel the kitchen has no price list for is
 * drawn as a sentence saying so rather than as fields that could not be saved.
 */

const CHANNELS: readonly TradeChannel[] = ['b2b', 'b2c'];

/** The units a pack is weighed or counted in; the purchase containers are not sale sizes. */
const PACK_UNITS: readonly MeasureUnit[] = ['kg', 'g', 'l', 'ml', 'piece'];

interface RowDraft {
    readonly quantity: string;
    readonly unit: MeasureUnit;
    readonly price: string;
}

function draftOf(offer: ItemChannelOffer | null): RowDraft {
    const exponent = offer === null ? 2 : minorUnitExponent(offer.currency);
    return {
        quantity: offer?.pack === null || offer === null ? '' : String(offer.pack.quantity),
        unit: offer?.pack?.unit ?? 'kg',
        price:
            offer === null || offer.amountMinor === null
                ? ''
                : (offer.amountMinor / 10 ** exponent).toFixed(exponent),
    };
}

type RowError = 'weight' | 'price' | 'priceNeedsWeight';

function rowError(row: RowDraft): RowError | null {
    const quantity = parseQuantity(row.quantity);
    const price = parseAmount(row.price);
    if (row.quantity.trim() !== '' && (quantity === null || quantity <= 0)) return 'weight';
    if (price === undefined || price === 0) return 'price';
    if (price !== null && quantity === null) return 'priceNeedsWeight';
    return null;
}

/**
 * The request half for one row, or `undefined` when the row says what the server already holds.
 * Empty everywhere is `null` — stop selling — but only for a row that had something to stop.
 */
function requestFor(
    row: RowDraft,
    saved: RowDraft,
    offer: ItemChannelOffer,
): SetItemChannelOffer | null | undefined {
    if (row.quantity === saved.quantity && row.unit === saved.unit && row.price === saved.price) {
        return undefined;
    }

    const quantity = parseQuantity(row.quantity);
    if (quantity === null) return saved.quantity === '' && saved.price === '' ? undefined : null;

    const price = parseAmount(row.price);
    const exponent = minorUnitExponent(offer.currency);

    return {
        quantity,
        unit: row.unit,
        amountMinor:
            price === null || price === undefined ? null : Math.round(price * 10 ** exponent),
    };
}

function isConflict(error: unknown): boolean {
    const failure = toFailure(error);
    return failure !== null && isConflictFailure(failure);
}

export interface ChannelPricesSectionProps {
    readonly itemId: ProductId | MealId;
    readonly testID?: string | undefined;
}

export function ChannelPricesSection({
    itemId,
    testID = 'kitchen-channel-prices',
}: ChannelPricesSectionProps) {
    const canView = useCan(PRICE_LIST_VIEW_PERMISSION);
    if (!canView) return null;

    return <ChannelPricesEditor itemId={itemId} testID={testID} />;
}

function ChannelPricesEditor({
    itemId,
    testID,
}: {
    readonly itemId: ProductId | MealId;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    // Both, because the write sizes the item's packs and prices them on the lists.
    const canManageCatalogue = useCan(CATALOGUE_MANAGE_PERMISSION);
    const canManagePrices = useCan(PRICE_LIST_MANAGE_PERMISSION);
    const canManage = canManageCatalogue && canManagePrices;

    const query = useItemChannelPricesQuery(itemId);
    const mutation = useSetItemChannelPricesMutation();

    const saved = useMemo(
        () => ({ b2b: draftOf(query.data?.b2b ?? null), b2c: draftOf(query.data?.b2c ?? null) }),
        [query.data],
    );
    const [rows, setRows] = useState(saved);
    const [attempted, setAttempted] = useState(false);

    // A fresh read (after a save, or another tab's) replaces the draft — adjusted during render,
    // React's pattern for state that follows a prop, rather than in an effect.
    const [shownFrom, setShownFrom] = useState(saved);
    if (shownFrom !== saved) {
        setShownFrom(saved);
        setRows(saved);
        setAttempted(false);
    }

    const unitOptions: readonly SelectOption[] = PACK_UNITS.map((unit) => ({
        value: unit,
        label: t(unitShortKey(unit)),
    }));

    const data: ItemChannelPrices | undefined = query.data;
    const errors = { b2b: rowError(rows.b2b), b2c: rowError(rows.b2c) };
    const dirty = CHANNELS.some(
        (channel) =>
            rows[channel].quantity !== saved[channel].quantity ||
            rows[channel].unit !== saved[channel].unit ||
            rows[channel].price !== saved[channel].price,
    );

    const save = () => {
        setAttempted(true);
        if (data === undefined || errors.b2b !== null || errors.b2c !== null) return;

        let request: SetItemChannelPricesRequest = { lockVersion: data.lockVersion };
        for (const channel of CHANNELS) {
            const offer = data[channel];
            if (offer === null) continue;
            const half = requestFor(rows[channel], saved[channel], offer);
            if (half !== undefined) request = { ...request, [channel]: half };
        }

        mutation.mutate(
            { itemId, request },
            {
                onSuccess: () => {
                    toast.show({ tone: 'success', message: t('kitchen:channelPrices.saved') });
                },
                onError: (error) => {
                    toast.show({
                        tone: 'danger',
                        message: isConflict(error)
                            ? t('kitchen:channelPrices.conflict')
                            : t('kitchen:channelPrices.failed'),
                    });
                    void query.refetch();
                },
            },
        );
    };

    const errorText = (error: RowError | null): string | undefined => {
        if (!attempted || error === null) return undefined;
        switch (error) {
            case 'weight':
                return t('kitchen:channelPrices.weightInvalid');
            case 'price':
                return t('kitchen:channelPrices.priceInvalid');
            case 'priceNeedsWeight':
                return t('kitchen:channelPrices.priceNeedsWeight');
        }
    };

    return (
        <FormSection
            variant="underlined"
            testID={testID}
            title={t('kitchen:channelPrices.title')}
            // A sentence, so it takes the wrapping slot under the title: on the aside, beside the
            // title, it never wrapped and pushed the header past a 772px SectionGrid cell.
            description={t('kitchen:channelPrices.hint')}
            actions={
                canManage ? (
                    <Button
                        testID={`${testID}-save`}
                        size="sm"
                        variant="primary"
                        label={t('kitchen:channelPrices.save')}
                        disabled={!dirty || data === undefined}
                        loading={mutation.isPending}
                        onPress={save}
                    />
                ) : undefined
            }
        >
            <Stack space="sm">
                {CHANNELS.map((channel) => {
                    const offer = data?.[channel] ?? null;
                    const row = rows[channel];
                    const rowTestId = `${testID}-${channel}`;
                    const label = t(`kitchen:channelPrices.${channel}`);

                    if (data !== undefined && offer === null) {
                        return (
                            <Text
                                key={channel}
                                testID={`${rowTestId}-unavailable`}
                                tone="secondary"
                            >
                                {t('kitchen:channelPrices.noPriceList', { channel: label })}
                            </Text>
                        );
                    }

                    const patch = (next: Partial<RowDraft>) => {
                        setRows({ ...rows, [channel]: { ...row, ...next } });
                    };
                    const error = errorText(errors[channel]);

                    return (
                        <View
                            key={channel}
                            testID={rowTestId}
                            className="z-auto flex-row flex-wrap items-start gap-tight"
                        >
                            <Text variant="label" className="w-16 pt-2">
                                {label}
                            </Text>
                            <View className="w-32">
                                <QuantityInput
                                    testID={`${rowTestId}-weight`}
                                    id={`${rowTestId}-weight`}
                                    size="sm"
                                    label={t('kitchen:channelPrices.weight', { channel: label })}
                                    placeholder={t('kitchen:fields.quantityPlaceholder')}
                                    value={row.quantity}
                                    disabled={!canManage}
                                    onChangeText={(next) => {
                                        patch({ quantity: next });
                                    }}
                                    {...(error !== undefined && errors[channel] === 'weight'
                                        ? { error }
                                        : {})}
                                />
                            </View>
                            <View className="z-auto w-28">
                                <Select
                                    testID={`${rowTestId}-unit`}
                                    id={`${rowTestId}-unit`}
                                    label={t('kitchen:channelPrices.unit', { channel: label })}
                                    options={unitOptions}
                                    value={row.unit}
                                    disabled={!canManage}
                                    onChange={(next) => {
                                        patch({ unit: next as MeasureUnit });
                                    }}
                                />
                            </View>
                            <View className="w-40">
                                <QuantityInput
                                    testID={`${rowTestId}-price`}
                                    id={`${rowTestId}-price`}
                                    size="sm"
                                    label={t('kitchen:channelPrices.price', { channel: label })}
                                    placeholder={t('kitchen:fields.unitPricePlaceholder')}
                                    value={row.price}
                                    disabled={!canManage}
                                    {...(offer === null ? {} : { unit: offer.currency })}
                                    onChangeText={(next) => {
                                        patch({ price: next });
                                    }}
                                    {...(error !== undefined && errors[channel] !== 'weight'
                                        ? { error }
                                        : {})}
                                />
                            </View>
                        </View>
                    );
                })}
            </Stack>
        </FormSection>
    );
}
