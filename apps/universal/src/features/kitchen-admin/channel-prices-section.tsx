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
import type { CurrencyCode, MealId, ProductId } from '@healthy360/domain-types';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCan } from '../../access/gate.tsx';
import { toFailure } from '../../data/hooks.ts';
import {
    useItemChannelPricesQuery,
    useSetItemChannelPricesMutation,
} from '../../data/kitchen-admin-hooks.ts';
import { useRepositories } from '../../data/repository-provider.tsx';
import {
    CATALOGUE_MANAGE_PERMISSION,
    PRICE_LIST_MANAGE_PERMISSION,
    PRICE_LIST_VIEW_PERMISSION,
} from './entity-registry.ts';
import { adminUnitsWith, parseAmount, unitShortKey } from './format.ts';

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
 * On a saved item it has its own save, because it is its own write: the packs and the prices land
 * together through `PUT /catalogue/items/{item}/channel-prices`, which needs the price-list
 * permission as well as the catalogue one. The host form's Save never touches it.
 *
 * On a new item there is no id to write against yet, so the rows are a draft the host form holds
 * (`draft`) and writes once the item exists (`useWriteChannelPriceDraft`) — the same way it writes
 * the photo. A card either way, like every other section of the editor.
 *
 * A row with a weight and no price keeps the pack and withdraws its price — sized, not sold. A row
 * cleared entirely stops selling on that channel. A channel the kitchen has no price list for is
 * drawn as a sentence saying so rather than as fields that could not be saved.
 */

const CHANNELS: readonly TradeChannel[] = ['b2b', 'b2c'];

export interface RowDraft {
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

/* ── a new item's draft ──────────────────────────────────────────────────────────────────────── */

export interface ChannelPriceDraft {
    readonly b2b: RowDraft;
    readonly b2c: RowDraft;
}

export const EMPTY_CHANNEL_PRICE_DRAFT: ChannelPriceDraft = {
    b2b: draftOf(null),
    b2c: draftOf(null),
};

/** Whether a draft can be written: every row empty, or a weight with a valid price. */
export function channelPriceDraftValid(draft: ChannelPriceDraft): boolean {
    return CHANNELS.every((channel) => rowError(draft[channel]) === null);
}

/** What writing a new item's draft came to: the failure, and the channels with nowhere to go. */
export interface ChannelPriceDraftResult {
    readonly error: unknown;
    readonly unavailable: readonly TradeChannel[];
}

/**
 * Writes a new item's B2B/B2C draft once the item exists. Reads the item's channels first — which
 * have a price list, in which currency, and the lock version the create left — then sends only the
 * rows that were filled in. A filled row for a channel with no price list is reported back rather
 * than dropped without a word.
 */
export function useWriteChannelPriceDraft(): (
    itemId: ProductId | MealId,
    draft: ChannelPriceDraft,
) => Promise<ChannelPriceDraftResult> {
    const repositories = useRepositories();
    const { mutateAsync } = useSetItemChannelPricesMutation();

    return useCallback(
        async (itemId, draft) => {
            const filled = CHANNELS.filter(
                (channel) =>
                    draft[channel].quantity.trim() !== '' || draft[channel].price.trim() !== '',
            );
            if (filled.length === 0) return { error: null, unavailable: [] };

            try {
                const current = await repositories.kitchenAdmin.getItemChannelPrices(itemId);
                let request: SetItemChannelPricesRequest = { lockVersion: current.lockVersion };
                const unavailable: TradeChannel[] = [];
                for (const channel of filled) {
                    const offer = current[channel];
                    if (offer === null) {
                        unavailable.push(channel);
                        continue;
                    }
                    const half = requestFor(
                        draft[channel],
                        EMPTY_CHANNEL_PRICE_DRAFT[channel],
                        offer,
                    );
                    if (half !== undefined) request = { ...request, [channel]: half };
                }
                if (request.b2b !== undefined || request.b2c !== undefined) {
                    await mutateAsync({ itemId, request });
                }
                return { error: null, unavailable };
            } catch (error) {
                return { error, unavailable: [] };
            }
        },
        [repositories, mutateAsync],
    );
}

/* ── the section ─────────────────────────────────────────────────────────────────────────────── */

export interface ChannelPricesSectionProps {
    /** The saved item; `null` on a new one, which then needs `draft`. */
    readonly itemId: ProductId | MealId | null;
    /** A new item's rows, held by the host form and written after the create. */
    readonly draft?:
        | {
              readonly value: ChannelPriceDraft;
              readonly onChange: (next: ChannelPriceDraft) => void;
              /** Whether the host form's Save has been pressed, so a bad row says so. */
              readonly attempted: boolean;
              /** The kitchen's currency, on the price before the item's lists are known. */
              readonly currency?: CurrencyCode | undefined;
          }
        | undefined;
    readonly testID?: string | undefined;
}

export function ChannelPricesSection({
    itemId,
    draft,
    testID = 'kitchen-channel-prices',
}: ChannelPricesSectionProps) {
    const canView = useCan(PRICE_LIST_VIEW_PERMISSION);
    if (!canView) return null;
    if (itemId === null) {
        return draft === undefined ? null : <ChannelPricesDraft draft={draft} testID={testID} />;
    }

    return <ChannelPricesEditor itemId={itemId} testID={testID} />;
}

function useCanManagePrices(): boolean {
    // Both, because the write sizes the item's packs and prices them on the lists.
    const canManageCatalogue = useCan(CATALOGUE_MANAGE_PERMISSION);
    const canManagePrices = useCan(PRICE_LIST_MANAGE_PERMISSION);
    return canManageCatalogue && canManagePrices;
}

/** A new item: the rows only — the host form's Save writes them once the item exists. */
function ChannelPricesDraft({
    draft,
    testID,
}: {
    readonly draft: NonNullable<ChannelPricesSectionProps['draft']>;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const canManage = useCanManagePrices();

    return (
        <FormSection
            first
            variant="card"
            testID={testID}
            title={t('kitchen:channelPrices.title')}
            description={t('kitchen:channelPrices.hint')}
        >
            <ChannelPriceRows
                rows={draft.value}
                onChange={draft.onChange}
                attempted={draft.attempted}
                currencyOf={() => draft.currency}
                unavailable={() => false}
                canManage={canManage}
                testID={testID}
            />
        </FormSection>
    );
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
    const canManage = useCanManagePrices();

    const query = useItemChannelPricesQuery(itemId);
    const mutation = useSetItemChannelPricesMutation();

    const saved = useMemo<ChannelPriceDraft>(
        () => ({ b2b: draftOf(query.data?.b2b ?? null), b2c: draftOf(query.data?.b2c ?? null) }),
        [query.data],
    );
    const [rows, setRows] = useState<ChannelPriceDraft>(saved);
    const [attempted, setAttempted] = useState(false);

    // A fresh read (after a save, or another tab's) replaces the draft — adjusted during render,
    // React's pattern for state that follows a prop, rather than in an effect.
    const [shownFrom, setShownFrom] = useState(saved);
    if (shownFrom !== saved) {
        setShownFrom(saved);
        setRows(saved);
        setAttempted(false);
    }

    const data: ItemChannelPrices | undefined = query.data;
    const dirty = CHANNELS.some(
        (channel) =>
            rows[channel].quantity !== saved[channel].quantity ||
            rows[channel].unit !== saved[channel].unit ||
            rows[channel].price !== saved[channel].price,
    );

    const save = () => {
        setAttempted(true);
        if (data === undefined || !channelPriceDraftValid(rows)) return;

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

    return (
        <FormSection
            first
            variant="card"
            testID={testID}
            title={t('kitchen:channelPrices.title')}
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
            <ChannelPriceRows
                rows={rows}
                onChange={setRows}
                attempted={attempted}
                currencyOf={(channel) => data?.[channel]?.currency}
                unavailable={(channel) => data !== undefined && data[channel] === null}
                canManage={canManage}
                testID={testID}
            />
        </FormSection>
    );
}

/** The two rows — label, weight, unit, price — shared by a saved item and a new one. */
function ChannelPriceRows({
    rows,
    onChange,
    attempted,
    currencyOf,
    unavailable,
    canManage,
    testID,
}: {
    readonly rows: ChannelPriceDraft;
    readonly onChange: (next: ChannelPriceDraft) => void;
    readonly attempted: boolean;
    readonly currencyOf: (channel: TradeChannel) => CurrencyCode | undefined;
    readonly unavailable: (channel: TradeChannel) => boolean;
    readonly canManage: boolean;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const errors = { b2b: rowError(rows.b2b), b2c: rowError(rows.b2c) };

    // The admin's Kg, L, Pc — plus a row's unit saved in grams or millilitres before the list was
    // narrowed, so the field shows what is stored rather than a blank.
    const unitOptions = (current: MeasureUnit): readonly SelectOption[] =>
        adminUnitsWith(current).map((unit) => ({ value: unit, label: t(unitShortKey(unit)) }));

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
        <Stack space="sm">
            {CHANNELS.map((channel) => {
                const row = rows[channel];
                const rowTestId = `${testID}-${channel}`;
                const label = t(`kitchen:channelPrices.${channel}`);
                const currency = currencyOf(channel);

                if (unavailable(channel)) {
                    return (
                        <Text key={channel} testID={`${rowTestId}-unavailable`} tone="secondary">
                            {t('kitchen:channelPrices.noPriceList', { channel: label })}
                        </Text>
                    );
                }

                const patch = (next: Partial<RowDraft>) => {
                    onChange({ ...rows, [channel]: { ...row, ...next } });
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
                                options={unitOptions(row.unit)}
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
                                {...(currency === undefined ? {} : { unit: currency })}
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
    );
}
