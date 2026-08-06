import { KitchenBranchId, KitchenId, SALES_CHANNELS } from '@healthy360/domain-types';
import type {
    DeliveryZoneId,
    DietClassification,
    Money,
    SalesChannel,
} from '@healthy360/domain-types';

import type {
    DeliveryZone,
    Kitchen,
    KitchenBranch,
    KitchenSalesChannels,
    OpeningHours,
} from '../../../contracts/marketplace.ts';
import { MOCK_BRANCH_IDS, MOCK_ORGANISATION_IDS } from '../../ids.ts';
import { aed, atOrThrow, fromMapOrThrow } from '../constants.ts';
import { deliveryZoneIdAt, kitchenBranchIdAt, kitchenIdAt } from '../ids.ts';

/**
 * Six kitchens, eleven branches and the delivery zones they reach.
 *
 * **Kitchen one is the foundation's Verdant Kitchen, by identifier.** The mock store already has an
 * organisation called Verdant Kitchen with a branch in Al Quoz, and the prototype marketplace is
 * meant to be describing the same business rather than a second one that happens to share a name —
 * so the kitchen and its Al Quoz branch reuse those identifiers exactly. Everything else is new.
 *
 * The eight sales-channel switches are deliberately *not* all true. A varied, honest spread is what
 * makes the channel filters, the B2B/B2C split and the "this kitchen does not deliver" states
 * reachable at all: one kitchen sells only to businesses, one is a counter that takes payment at the
 * till and hands the food over, and the rest sit in between.
 */

/** Every channel off. Spreads below switch on only what they mean. */
const NO_CHANNELS: KitchenSalesChannels = {
    b2c: false,
    b2b: false,
    marketplace: false,
    pos: false,
    subscription: false,
    delivery: false,
    pickup: false,
    corporate: false,
};

export function makeChannels(enabled: readonly SalesChannel[]): KitchenSalesChannels {
    const channels: Record<SalesChannel, boolean> = { ...NO_CHANNELS };
    for (const channel of enabled) channels[channel] = true;
    return channels;
}

/** True when the kitchen is configured for every one of the requested channels. */
export function hasChannels(
    channels: KitchenSalesChannels,
    required: readonly SalesChannel[],
): boolean {
    return required.every((channel) => channels[channel]);
}

/** The eight switches, in declaration order — for the showcase table and the fixture test. */
export const CHANNEL_ORDER: readonly SalesChannel[] = SALES_CHANNELS;

/* ------------------------------------------------------------------------------------------------
 * Delivery zones
 * ---------------------------------------------------------------------------------------------- */

type ZoneRow = readonly [
    key: string,
    name: string,
    area: string,
    deliveryFeeFils: number | null,
    minimumOrderFils: number | null,
    estimatedMinutes: number | null,
];

const ZONE_ROWS: readonly ZoneRow[] = [
    ['downtown', 'Downtown ring', 'Downtown', 900, 6000, 45],
    ['marina', 'Marina and beachfront', 'Dubai Marina', 1200, 7500, 55],
    ['jumeirah', 'Jumeirah coast', 'Jumeirah 1', 1000, 6500, 50],
    ['business_bay', 'Business Bay', 'Business Bay', 900, 6000, 40],
    ['al_barsha', 'Al Barsha and Tecom', 'Al Barsha', 1100, 6500, 55],
    ['deira', 'Deira and Al Nahda', 'Deira', 1000, 5500, 60],
    ['industrial', 'Industrial corridor', 'Dubai Industrial City', 0, 45000, 240],
    ['northern', 'Northern emirates', 'Sharjah', 2500, 60000, 300],
];

export interface MakeDeliveryZoneOverrides {
    readonly name?: string | undefined;
    readonly countryCode?: string | undefined;
    readonly deliveryFee?: Money | null | undefined;
    readonly minimumOrder?: Money | null | undefined;
    readonly estimatedMinutes?: number | null | undefined;
}

export function makeDeliveryZone(
    row: ZoneRow,
    ordinal: number,
    overrides: MakeDeliveryZoneOverrides = {},
): DeliveryZone {
    const [, name, area, deliveryFeeFils, minimumOrderFils, estimatedMinutes] = row;
    return {
        id: deliveryZoneIdAt(ordinal),
        name: overrides.name ?? name,
        area,
        countryCode: overrides.countryCode ?? 'AE',
        deliveryFee:
            overrides.deliveryFee === undefined
                ? deliveryFeeFils === null
                    ? null
                    : aed(deliveryFeeFils)
                : overrides.deliveryFee,
        minimumOrder:
            overrides.minimumOrder === undefined
                ? minimumOrderFils === null
                    ? null
                    : aed(minimumOrderFils)
                : overrides.minimumOrder,
        estimatedMinutes:
            overrides.estimatedMinutes === undefined
                ? estimatedMinutes
                : overrides.estimatedMinutes,
    };
}

export const PROTOTYPE_DELIVERY_ZONES: readonly DeliveryZone[] = ZONE_ROWS.map((row, index) =>
    makeDeliveryZone(row, index),
);

const ZONES_BY_KEY: ReadonlyMap<string, DeliveryZone> = new Map(
    ZONE_ROWS.map((row, index) => [
        atOrThrow(row, 0, 'delivery-zone key') as string,
        atOrThrow(PROTOTYPE_DELIVERY_ZONES, index, 'delivery zone'),
    ]),
);

export function deliveryZoneByKey(key: string): DeliveryZone {
    return fromMapOrThrow(ZONES_BY_KEY, key, 'delivery zone');
}

export function deliveryZoneById(id: DeliveryZoneId): DeliveryZone | null {
    return PROTOTYPE_DELIVERY_ZONES.find((zone) => zone.id === id) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Opening hours
 * ---------------------------------------------------------------------------------------------- */

export interface MakeOpeningHoursOptions {
    readonly opensAt?: string | undefined;
    readonly closesAt?: string | undefined;
    readonly orderCutOffAt?: string | undefined;
    /** ISO weekdays the branch is shut. */
    readonly closedOn?: readonly number[] | undefined;
}

/** A full week of opening hours; a closed day carries three nulls rather than being absent. */
export function makeOpeningHours(options: MakeOpeningHoursOptions = {}): readonly OpeningHours[] {
    const closed = new Set(options.closedOn ?? []);
    return [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
        closed.has(weekday)
            ? { weekday, opensAt: null, closesAt: null, orderCutOffAt: null }
            : {
                  weekday,
                  opensAt: options.opensAt ?? '08:00',
                  closesAt: options.closesAt ?? '22:00',
                  orderCutOffAt: options.orderCutOffAt ?? '18:00',
              },
    );
}

/* ------------------------------------------------------------------------------------------------
 * Branches
 * ---------------------------------------------------------------------------------------------- */

type BranchRow = readonly [
    key: string,
    kitchenKey: string,
    name: string,
    area: string,
    zoneKeys: readonly string[],
    supportsPickup: boolean,
    closedOn: readonly number[],
];

// One row per branch; reflowing it hides which kitchen a branch belongs to.
// prettier-ignore
const BRANCH_ROWS: readonly BranchRow[] = [
    ['verdant_al_quoz', 'verdant', 'Al Quoz', 'Al Quoz', ['downtown', 'business_bay', 'al_barsha'], true, []],
    ['verdant_business_bay', 'verdant', 'Business Bay', 'Business Bay', ['business_bay', 'downtown'], true, []],
    ['verdant_al_barsha', 'verdant', 'Al Barsha', 'Al Barsha', ['al_barsha', 'marina'], false, [5]],
    ['saffron_jumeirah', 'saffron', 'Jumeirah Beach Road', 'Jumeirah 1', ['jumeirah', 'downtown'], false, []],
    ['saffron_marina', 'saffron', 'Marina Walk', 'Dubai Marina', ['marina', 'al_barsha'], false, [7]],
    ['daily_pot_al_nahda', 'daily_pot', 'Al Nahda', 'Al Nahda', ['deira'], true, []],
    ['daily_pot_deira', 'daily_pot', 'Deira Waterfront', 'Deira', ['deira', 'downtown'], true, []],
    ['northwind_industrial', 'northwind', 'Dubai Industrial City', 'Dubai Industrial City', ['industrial', 'northern'], false, [6, 7]],
    ['northwind_sharjah', 'northwind', 'Sharjah Depot', 'Sharjah', ['northern'], false, [6, 7]],
    ['olive_terrace_creative', 'olive_terrace', 'Al Quoz Creative', 'Al Quoz', [], true, []],
    ['riverstone_ras_al_khor', 'riverstone', 'Ras Al Khor', 'Ras Al Khor', ['downtown', 'business_bay', 'deira'], false, []],
];

export interface MakeKitchenBranchOverrides {
    readonly name?: string | undefined;
    readonly area?: string | undefined;
    readonly timeZone?: string | undefined;
    readonly isActive?: boolean | undefined;
    readonly deliveryZones?: readonly DeliveryZone[] | undefined;
    readonly openingHours?: readonly OpeningHours[] | undefined;
}

export function makeKitchenBranch(
    row: BranchRow,
    id: KitchenBranchId,
    kitchenId: KitchenId,
    overrides: MakeKitchenBranchOverrides = {},
): KitchenBranch {
    const [, , name, area, zoneKeys, supportsPickup, closedOn] = row;
    return {
        id,
        kitchenId,
        name: overrides.name ?? name,
        area: overrides.area ?? area,
        countryCode: 'AE',
        timeZone: overrides.timeZone ?? 'Asia/Dubai',
        deliveryZones: overrides.deliveryZones ?? zoneKeys.map(deliveryZoneByKey),
        openingHours: overrides.openingHours ?? makeOpeningHours({ closedOn }),
        supportsPickup,
        isActive: overrides.isActive ?? true,
    };
}

/* ------------------------------------------------------------------------------------------------
 * Kitchens
 * ---------------------------------------------------------------------------------------------- */

type KitchenRow = readonly [
    key: string,
    name: string,
    slug: string,
    tagline: string,
    description: string,
    cuisines: readonly string[],
    diets: readonly DietClassification[],
    channels: readonly SalesChannel[],
    rating: number | null,
    ratingCount: number,
    isVerified: boolean,
];

const KITCHEN_ROWS: readonly KitchenRow[] = [
    [
        'verdant',
        'Verdant Kitchen',
        'verdant-kitchen',
        'Vegetable-forward cooking, portioned to a target',
        'A production kitchen in Al Quoz cooking a vegetable-led menu for delivery, subscription ' +
            'and corporate catering. Every dish is portioned against a stated energy and protein ' +
            'figure so a plan can be built from it.',
        ['Levantine', 'Mediterranean'],
        ['vegetarian', 'vegan', 'mediterranean', 'high_protein'],
        ['b2c', 'b2b', 'marketplace', 'subscription', 'delivery', 'pickup', 'corporate'],
        4.6,
        412,
        true,
    ],
    [
        'saffron',
        'Saffron and Sea',
        'saffron-and-sea',
        'Coastal cooking, delivered the day it is made',
        'A coastal kitchen working mainly with fish and shellfish, cooking to order for household ' +
            'delivery and weekly subscriptions along the Jumeirah and Marina corridor.',
        ['Coastal', 'Mediterranean'],
        ['pescatarian', 'mediterranean'],
        ['b2c', 'marketplace', 'subscription', 'delivery'],
        4.4,
        188,
        true,
    ],
    [
        'daily_pot',
        'The Daily Pot',
        'the-daily-pot',
        'Everyday cooking, collected or delivered',
        'A neighbourhood kitchen and shopfront cooking a rotating everyday menu. Orders can be ' +
            'placed at the counter, collected, or delivered across Deira.',
        ['Levantine', 'Home cooking'],
        ['omnivore', 'halal_friendly'],
        ['b2c', 'marketplace', 'pos', 'delivery', 'pickup'],
        4.2,
        96,
        false,
    ],
    [
        'northwind',
        'Northwind Provisions',
        'northwind-provisions',
        'Prepared meals, by the pallet',
        'A wholesale production site supplying prepared meals to clinics, staff canteens and ' +
            'facilities teams. It does not sell to households and publishes no consumer price.',
        ['Production'],
        ['omnivore', 'high_protein'],
        ['b2b', 'delivery', 'corporate'],
        null,
        0,
        true,
    ],
    [
        'olive_terrace',
        'Olive Terrace Counter',
        'olive-terrace-counter',
        'A counter, a queue, and lunch in a box',
        'A single counter in a creative district. Food is paid for at the till and carried away; ' +
            'there is no delivery, no subscription and no marketplace listing.',
        ['Mediterranean'],
        ['vegetarian', 'mediterranean'],
        ['pos', 'pickup'],
        4.1,
        54,
        false,
    ],
    [
        'riverstone',
        'Riverstone Meal Works',
        'riverstone-meal-works',
        'High-protein cooking for training weeks',
        'A production kitchen built around higher-protein plans for people training regularly, ' +
            'supplying households, gyms and corporate wellbeing programmes.',
        ['Contemporary', 'Grill'],
        ['high_protein', 'low_carb', 'omnivore'],
        // No pickup: a production site off a industrial road, with no counter to collect from.
        ['b2c', 'b2b', 'marketplace', 'subscription', 'delivery', 'corporate'],
        4.7,
        263,
        true,
    ],
];

/**
 * Kitchen identifiers.
 *
 * Kitchen one is the Verdant Kitchen organisation the mock store already knows about; the rest are
 * newly minted in the `f0` band.
 */
export const PROTOTYPE_KITCHEN_IDS: Readonly<Record<string, KitchenId>> = {
    verdant: KitchenId.unsafe(MOCK_ORGANISATION_IDS.verdantKitchen),
    saffron: kitchenIdAt(1),
    daily_pot: kitchenIdAt(2),
    northwind: kitchenIdAt(3),
    olive_terrace: kitchenIdAt(4),
    riverstone: kitchenIdAt(5),
};

/** Branch identifiers. The Verdant Al Quoz branch reuses the mock store's branch identifier. */
const BRANCH_IDS: Readonly<Record<string, KitchenBranchId>> = Object.fromEntries(
    BRANCH_ROWS.map((row, index) => {
        const key = atOrThrow(row, 0, 'branch key') as string;
        return [
            key,
            key === 'verdant_al_quoz'
                ? KitchenBranchId.unsafe(MOCK_BRANCH_IDS.alQuoz)
                : kitchenBranchIdAt(index),
        ];
    }),
);

export interface MakeKitchenOverrides {
    readonly name?: string | undefined;
    readonly tagline?: string | undefined;
    readonly channels?: KitchenSalesChannels | undefined;
    readonly branches?: readonly KitchenBranch[] | undefined;
    readonly rating?: number | null | undefined;
    readonly ratingCount?: number | undefined;
    readonly isVerified?: boolean | undefined;
    readonly deliveryWindows?: Kitchen['deliveryWindows'] | undefined;
}

export function makeKitchen(row: KitchenRow, overrides: MakeKitchenOverrides = {}): Kitchen {
    const [
        key,
        name,
        slug,
        tagline,
        description,
        cuisines,
        diets,
        channels,
        rating,
        ratingCount,
        isVerified,
    ] = row;
    const id = fromMapOrThrow(new Map(Object.entries(PROTOTYPE_KITCHEN_IDS)), key, 'kitchen id');

    return {
        id,
        name: overrides.name ?? name,
        slug,
        tagline: overrides.tagline ?? tagline,
        description,
        countryCode: 'AE',
        cuisines,
        dietClassifications: diets,
        channels: overrides.channels ?? makeChannels(channels),
        branches:
            overrides.branches ??
            BRANCH_ROWS.filter((branch) => branch[1] === key).map((branch) =>
                makeKitchenBranch(
                    branch,
                    fromMapOrThrow(new Map(Object.entries(BRANCH_IDS)), branch[0], 'branch id'),
                    id,
                ),
            ),
        rating: overrides.rating === undefined ? rating : overrides.rating,
        ratingCount: overrides.ratingCount ?? ratingCount,
        imagePlaceholderId: `kitchen-${slug}`,
        isVerified: overrides.isVerified ?? isVerified,
        deliveryWindows:
            overrides.deliveryWindows ??
            ([
                {
                    code: 'morning',
                    label: 'Morning',
                    startsAt: '09:00',
                    endsAt: '12:00',
                    weekdays: [],
                },
                {
                    code: 'evening',
                    label: 'Evening',
                    startsAt: '18:00',
                    endsAt: '21:00',
                    weekdays: [1, 2, 3, 4],
                },
            ] as const),
    };
}

export const PROTOTYPE_KITCHENS: readonly Kitchen[] = KITCHEN_ROWS.map((row) => makeKitchen(row));

export const PROTOTYPE_KITCHEN_BRANCHES: readonly KitchenBranch[] = PROTOTYPE_KITCHENS.flatMap(
    (kitchen) => kitchen.branches,
);

const KITCHENS_BY_KEY: ReadonlyMap<string, Kitchen> = new Map(
    KITCHEN_ROWS.map((row, index) => [
        atOrThrow(row, 0, 'kitchen key') as string,
        atOrThrow(PROTOTYPE_KITCHENS, index, 'kitchen'),
    ]),
);

export function kitchenByKey(key: string): Kitchen {
    return fromMapOrThrow(KITCHENS_BY_KEY, key, 'kitchen');
}

export function kitchenById(id: KitchenId): Kitchen | null {
    return PROTOTYPE_KITCHENS.find((kitchen) => kitchen.id === id) ?? null;
}

/** The kitchens a consumer may browse — the ones actually configured for the marketplace. */
export const MARKETPLACE_KITCHEN_KEYS: readonly string[] = KITCHEN_ROWS.filter((row) =>
    row[7].includes('marketplace'),
).map((row) => row[0]);
