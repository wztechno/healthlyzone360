import type { IsoDateTime } from '@healthy360/domain-types';

/** Fridge and freezer readings twice a day, and a batch's cooking core temperature. */

export type TemperatureSlot = 'am' | 'pm';

export interface TemperatureUnit {
    readonly id: string;
    readonly name: string;
    readonly kind: 'fridge' | 'freezer';
    readonly minC: string;
    readonly maxC: string;
    readonly active: boolean;
}

/** The unit form. No `id` yet on a new one. */
export type TemperatureUnitDraft = Omit<TemperatureUnit, 'id'> & { readonly id: string | null };

export interface TemperatureReading {
    readonly id: string;
    readonly unitId: string;
    readonly unitName: string;
    readonly readingDate: string;
    readonly slot: TemperatureSlot;
    readonly celsius: string;
    readonly outOfRange: boolean;
    readonly note: string | null;
    readonly recordedByName: string | null;
}

export interface CookingTemperature {
    readonly id: string;
    readonly batchLabel: string | null;
    readonly recipe: string | null;
    readonly celsius: string;
    readonly note: string | null;
    readonly recordedByName: string | null;
    readonly recordedAt: IsoDateTime;
}

export interface TemperatureLog {
    readonly units: readonly TemperatureUnit[];
    readonly readings: readonly TemperatureReading[];
    readonly cooking: readonly CookingTemperature[];
}

export interface RecordTemperatureRequest {
    readonly unitId: string;
    readonly slot: TemperatureSlot;
    readonly celsius: string;
    readonly note: string | null;
}

export interface RecordCookingTemperatureRequest {
    readonly productionOrderId: string;
    readonly celsius: string;
}
