import {
    GoodsReceiptId,
    ProductionOrderId,
    QualityCheckId,
    StockItemId,
    SupplierId,
} from '@healthy360/domain-types';

/**
 * Measurement-unit identifiers are plain strings (the contract's `MeasurementUnitOption.id` is not
 * a branded domain type), so no `unsafe` wrap is needed — the deterministic UUID is returned as-is.
 */

/**
 * Deterministic identifiers for the kitchen ops mock world (O1–O4).
 *
 * Same discipline as `../prototype/ids.ts`: a fixed UUIDv7 prefix and a two-hex-digit band per
 * entity type, so an identifier read off a failing assertion says what it points at without a
 * lookup. The prefix is `01935f6e-…` — one past the K1 prototype world's `01935f6d-…` — so this
 * world is provably disjoint from every other mock band.
 */
export const KITCHEN_OPS_ID_PREFIX = '01935f6e-0000-7000-8000-';

export const KITCHEN_OPS_ID_BANDS = {
    stockItem: 'a0',
    supplier: 'b0',
    goodsReceipt: 'c0',
    productionOrder: 'd0',
    qualityCheck: 'e0',
    measurementUnit: 'f0',
} as const;

export type KitchenOpsIdBand = keyof typeof KITCHEN_OPS_ID_BANDS;

export const KITCHEN_OPS_ORDINAL_LIMIT = 0xff;

export function kitchenOpsId(band: KitchenOpsIdBand, ordinal: number): string {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > KITCHEN_OPS_ORDINAL_LIMIT) {
        throw new RangeError(
            `Kitchen ops ordinal ${String(ordinal)} is outside the ${band} band (0–${String(KITCHEN_OPS_ORDINAL_LIMIT)}).`,
        );
    }
    const suffix = ordinal.toString(16).padStart(2, '0');
    return `${KITCHEN_OPS_ID_PREFIX}00000000${KITCHEN_OPS_ID_BANDS[band]}${suffix}`;
}

export const stockItemIdAt = (ordinal: number): StockItemId =>
    StockItemId.unsafe(kitchenOpsId('stockItem', ordinal));
export const supplierIdAt = (ordinal: number): SupplierId =>
    SupplierId.unsafe(kitchenOpsId('supplier', ordinal));
export const goodsReceiptIdAt = (ordinal: number): GoodsReceiptId =>
    GoodsReceiptId.unsafe(kitchenOpsId('goodsReceipt', ordinal));
export const productionOrderIdAt = (ordinal: number): ProductionOrderId =>
    ProductionOrderId.unsafe(kitchenOpsId('productionOrder', ordinal));
export const qualityCheckIdAt = (ordinal: number): QualityCheckId =>
    QualityCheckId.unsafe(kitchenOpsId('qualityCheck', ordinal));
export const measurementUnitIdAt = (ordinal: number): string =>
    kitchenOpsId('measurementUnit', ordinal);

/**
 * Where the store starts minting identifiers for rows a *person* creates in the running session.
 * Fixtures occupy the low ordinals; runtime rows occupy `0x80` upwards (same convention as the K1
 * prototype world's `PROTOTYPE_RUNTIME_ORDINAL_START`).
 */
export const KITCHEN_OPS_RUNTIME_ORDINAL_START = 0x80;
