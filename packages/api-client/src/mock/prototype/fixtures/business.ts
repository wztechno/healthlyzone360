import type {
    CorporateProgrammeId,
    CurrencyCode,
    Money,
    OrganisationId,
    QuotationId,
    SalesChannel,
} from '@healthy360/domain-types';

import type {
    CatalogueItem,
    CatalogueItemKind,
    CorporateProgramme,
    Quotation,
    QuotationLine,
    VolumeTier,
} from '../../../contracts/business.ts';
import { MOCK_ORGANISATION_IDS } from '../../ids.ts';
import { PROTOTYPE_NOW, aed, atOrThrow, currency, fromMapOrThrow } from '../constants.ts';
import {
    buyerOrganisationIdAt,
    corporateProgrammeIdAt,
    quotationIdAt,
    volumeTierIdAt,
} from '../ids.ts';
import { kitchenByKey } from './kitchens.ts';
import { mealByKey } from './meals.ts';
import { planByKey } from './plans.ts';

/**
 * Corporate programmes, negotiated catalogues and quotations.
 *
 * This module is the *only* place in the fixture world where a negotiated price exists. That is the
 * enforcement mechanism, not a convention: a consumer screen has no type for a contract price and no
 * repository to fetch one from, so it cannot leak what it cannot represent. The four representative
 * arrangements the prompt asks for are all here — an employee meal package, a clinic bulk
 * programme, a gym high-protein package and a wholesale prepared-meal offer — and one catalogue line
 * is priced in **SAR** rather than AED, so that anything which tries to total a mixed-currency
 * catalogue fails loudly instead of quietly adding dirhams to riyals.
 */

/** The buyers. Two are the mock world's existing organisations; two are new to the prototype. */
export const PROTOTYPE_BUYER_ORGANISATION_IDS: Readonly<Record<string, OrganisationId>> = {
    cedar_clinic: MOCK_ORGANISATION_IDS.cedarClinic,
    verdant_kitchen: MOCK_ORGANISATION_IDS.verdantKitchen,
    meridian_fitness: buyerOrganisationIdAt(0),
    harbour_facilities: buyerOrganisationIdAt(1),
};

type ProgrammeRow = readonly [
    key: string,
    buyerKey: string,
    name: string,
    summary: string,
    kitchenKeys: readonly string[],
    deliveryLocations: readonly string[],
    headcount: number,
    employeeSubsidyFils: number | null,
    startsAt: string,
    endsAt: string | null,
    accountManagerName: string | null,
    isActive: boolean,
];

const PROGRAMME_ROWS: readonly ProgrammeRow[] = [
    [
        'corporate_employee_package',
        'cedar_clinic',
        'Cedar Clinic staff meal package',
        'A subsidised lunch for clinical and reception staff across both branches, five days a week.',
        ['verdant', 'daily_pot'],
        ['Hamra clinic', 'Jounieh clinic'],
        84,
        1200,
        '2026-04-01',
        '2027-03-31',
        'Dana Fakhoury',
        true,
    ],
    [
        'clinic_bulk_programme',
        'cedar_clinic',
        'Cedar Clinic patient bulk programme',
        'Prepared meals supplied in bulk for patients on supervised plans, ordered a week ahead.',
        ['northwind', 'verdant'],
        ['Hamra clinic'],
        150,
        null,
        '2026-01-15',
        null,
        'Dana Fakhoury',
        true,
    ],
    [
        'gym_high_protein_package',
        'meridian_fitness',
        'Meridian Fitness high-protein package',
        'A higher-protein package sold through the gym to members on structured training blocks.',
        ['riverstone'],
        ['Meridian Fitness — Business Bay', 'Meridian Fitness — Marina'],
        320,
        800,
        '2026-06-01',
        '2027-05-31',
        'Karim Nassar',
        true,
    ],
    [
        'wholesale_prepared_meal_offer',
        'harbour_facilities',
        'Harbour Facilities wholesale offer',
        'Wholesale prepared meals for staff canteens, delivered by the pallet on a fixed schedule.',
        ['northwind'],
        ['Dubai Industrial City depot', 'Sharjah depot'],
        1200,
        null,
        '2026-02-01',
        null,
        null,
        false,
    ],
];

export interface MakeCorporateProgrammeOverrides {
    readonly name?: string | undefined;
    readonly headcount?: number | undefined;
    readonly employeeSubsidy?: Money | null | undefined;
    readonly isActive?: boolean | undefined;
    readonly accountManagerName?: string | null | undefined;
}

export function makeCorporateProgramme(
    row: ProgrammeRow,
    ordinal: number,
    overrides: MakeCorporateProgrammeOverrides = {},
): CorporateProgramme {
    const [
        ,
        buyerKey,
        name,
        summary,
        kitchenKeys,
        deliveryLocations,
        headcount,
        employeeSubsidyFils,
        startsAt,
        endsAt,
        accountManagerName,
        isActive,
    ] = row;

    return {
        id: corporateProgrammeIdAt(ordinal),
        organisationId: fromMapOrThrow(
            new Map(Object.entries(PROTOTYPE_BUYER_ORGANISATION_IDS)),
            buyerKey,
            'buyer organisation',
        ),
        name: overrides.name ?? name,
        summary,
        kitchenIds: kitchenKeys.map((key) => kitchenByKey(key).id),
        deliveryLocations,
        headcount: overrides.headcount ?? headcount,
        employeeSubsidy:
            overrides.employeeSubsidy === undefined
                ? employeeSubsidyFils === null
                    ? null
                    : aed(employeeSubsidyFils)
                : overrides.employeeSubsidy,
        startsAt,
        endsAt,
        accountManagerName:
            overrides.accountManagerName === undefined
                ? accountManagerName
                : overrides.accountManagerName,
        isActive: overrides.isActive ?? isActive,
    };
}

export const PROTOTYPE_PROGRAMMES: readonly CorporateProgramme[] = PROGRAMME_ROWS.map(
    (row, index) => makeCorporateProgramme(row, index),
);

const PROGRAMMES_BY_KEY: ReadonlyMap<string, CorporateProgramme> = new Map(
    PROGRAMME_ROWS.map((row, index) => [
        atOrThrow(row, 0, 'programme key') as string,
        atOrThrow(PROTOTYPE_PROGRAMMES, index, 'corporate programme'),
    ]),
);

export function programmeByKey(key: string): CorporateProgramme {
    return fromMapOrThrow(PROGRAMMES_BY_KEY, key, 'corporate programme');
}

export function programmeById(id: CorporateProgrammeId): CorporateProgramme | null {
    return PROTOTYPE_PROGRAMMES.find((programme) => programme.id === id) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Volume tiers and catalogue lines
 * ---------------------------------------------------------------------------------------------- */

type TierRow = readonly [
    minimumQuantity: number,
    maximumQuantity: number | null,
    unitPriceMinor: number,
    leadTimeDays: number,
];

export function makeVolumeTier(row: TierRow, ordinal: number, code: CurrencyCode): VolumeTier {
    const [minimumQuantity, maximumQuantity, unitPriceMinor, leadTimeDays] = row;
    return {
        id: volumeTierIdAt(ordinal),
        minimumQuantity,
        maximumQuantity,
        unitPrice: currency(unitPriceMinor, code),
        leadTimeDays,
    };
}

type CatalogueRow = readonly [
    key: string,
    programmeKey: string,
    kind: CatalogueItemKind,
    name: string,
    description: string,
    kitchenKey: string,
    mealKey: string | null,
    planKey: string | null,
    minimumOrderQuantity: number,
    contractPriceMinor: number,
    contractCurrency: CurrencyCode,
    leadTimeDays: number,
    deliveryWeekdays: readonly number[],
    channels: readonly SalesChannel[],
    supportsRecurringOrder: boolean,
    tiers: readonly TierRow[],
];

const CATALOGUE_ROWS: readonly CatalogueRow[] = [
    [
        'staff_lunch_box',
        'corporate_employee_package',
        'meal',
        'Staff lunch box — herb chicken',
        'The Herb Garden bowl at a negotiated staff rate, delivered to reception before noon.',
        'verdant',
        'verdant_herb_garden_bowl',
        null,
        40,
        2600,
        'AED',
        2,
        [1, 2, 3, 4, 5],
        ['b2b', 'corporate', 'delivery'],
        true,
        [
            [40, 99, 2600, 2],
            [100, 249, 2400, 3],
            [250, null, 2200, 4],
        ],
    ],
    [
        'patient_bulk_tray',
        'clinic_bulk_programme',
        'bulk_package',
        'Patient bulk tray — 20 portions',
        'Twenty portions of a chosen dish in a chilled tray, for supervised patient plans.',
        'northwind',
        null,
        null,
        10,
        38000,
        'AED',
        5,
        [1, 3, 5],
        ['b2b', 'corporate', 'delivery'],
        true,
        [
            [10, 24, 38000, 5],
            [25, null, 35500, 7],
        ],
    ],
    [
        'member_protein_plan',
        'gym_high_protein_package',
        'meal_plan',
        'Member high-protein plan',
        'The Strength Build plan at a members’ rate, billed to the gym rather than the member.',
        'riverstone',
        null,
        'strength_build',
        25,
        58000,
        'AED',
        3,
        [1, 2, 3, 4, 5, 6],
        ['b2b', 'corporate', 'subscription'],
        true,
        [
            [25, 99, 58000, 3],
            [100, null, 54000, 5],
        ],
    ],
    [
        'wholesale_prepared_pallet',
        'wholesale_prepared_meal_offer',
        'bulk_package',
        'Wholesale prepared-meal pallet (SAR)',
        'A cross-border wholesale line priced in Saudi riyals, delivered to a depot rather than a site.',
        'northwind',
        null,
        null,
        200,
        1150,
        'SAR',
        10,
        [2, 4],
        ['b2b', 'delivery'],
        false,
        [
            [200, 499, 1150, 10],
            [500, null, 1050, 14],
        ],
    ],
];

export interface MakeCatalogueItemOverrides {
    readonly name?: string | undefined;
    readonly minimumOrderQuantity?: number | undefined;
    readonly contractPrice?: Money | null | undefined;
    readonly leadTimeDays?: number | undefined;
    readonly supportsRecurringOrder?: boolean | undefined;
    readonly volumeTiers?: readonly VolumeTier[] | undefined;
}

export function makeCatalogueItem(
    row: CatalogueRow,
    tierOrdinalBase: number,
    overrides: MakeCatalogueItemOverrides = {},
): CatalogueItem {
    const [
        key,
        programmeKey,
        kind,
        name,
        description,
        kitchenKey,
        mealKey,
        planKey,
        minimumOrderQuantity,
        contractPriceMinor,
        contractCurrency,
        leadTimeDays,
        deliveryWeekdays,
        channels,
        supportsRecurringOrder,
        tiers,
    ] = row;

    return {
        // A catalogue line is identified by a readable code rather than a UUID: it is negotiated
        // paperwork, and a buyer quoting `staff-lunch-box` on a purchase order is the normal case.
        id: `catalogue-${key.replace(/_/g, '-')}`,
        programmeId: programmeByKey(programmeKey).id,
        kind,
        name: overrides.name ?? name,
        description,
        kitchenId: kitchenByKey(kitchenKey).id,
        mealId: mealKey === null ? null : mealByKey(mealKey).id,
        planId: planKey === null ? null : planByKey(planKey).id,
        minimumOrderQuantity: overrides.minimumOrderQuantity ?? minimumOrderQuantity,
        volumeTiers:
            overrides.volumeTiers ??
            tiers.map((tier, index) =>
                makeVolumeTier(tier, tierOrdinalBase + index, contractCurrency),
            ),
        contractPrice:
            overrides.contractPrice === undefined
                ? currency(contractPriceMinor, contractCurrency)
                : overrides.contractPrice,
        leadTimeDays: overrides.leadTimeDays ?? leadTimeDays,
        deliveryWeekdays,
        channels,
        supportsRecurringOrder: overrides.supportsRecurringOrder ?? supportsRecurringOrder,
        imagePlaceholderId: `catalogue-${key.replace(/_/g, '-')}`,
    };
}

export const PROTOTYPE_CATALOGUE_ITEMS: readonly CatalogueItem[] = CATALOGUE_ROWS.reduce<{
    items: CatalogueItem[];
    tierOrdinal: number;
}>(
    (accumulator, row) => {
        accumulator.items.push(makeCatalogueItem(row, accumulator.tierOrdinal));
        accumulator.tierOrdinal += row[15].length;
        return accumulator;
    },
    { items: [], tierOrdinal: 0 },
).items;

export function catalogueItemById(id: string): CatalogueItem | null {
    return PROTOTYPE_CATALOGUE_ITEMS.find((item) => item.id === id) ?? null;
}

export function catalogueItemsForProgramme(
    programmeId: CorporateProgrammeId,
): readonly CatalogueItem[] {
    return PROTOTYPE_CATALOGUE_ITEMS.filter((item) => item.programmeId === programmeId);
}

/* ------------------------------------------------------------------------------------------------
 * Quotations
 * ---------------------------------------------------------------------------------------------- */

export interface MakeQuotationOverrides {
    readonly state?: Quotation['state'] | undefined;
    readonly lines?: readonly QuotationLine[] | undefined;
    readonly requestedTotal?: Money | null | undefined;
    readonly note?: string | null | undefined;
    readonly recurring?: boolean | undefined;
    readonly requestedAt?: string | undefined;
    readonly respondedAt?: string | null | undefined;
    readonly expiresAt?: string | null | undefined;
}

export function makeQuotation(
    id: QuotationId,
    programmeId: CorporateProgrammeId,
    reference: string,
    overrides: MakeQuotationOverrides = {},
): Quotation {
    return {
        id,
        programmeId,
        state: overrides.state ?? 'draft',
        reference,
        lines: overrides.lines ?? [],
        requestedTotal: overrides.requestedTotal ?? null,
        requestedDeliveryDate: null,
        recurring: overrides.recurring ?? false,
        note: overrides.note === undefined ? null : overrides.note,
        requestedAt: overrides.requestedAt ?? PROTOTYPE_NOW,
        respondedAt: overrides.respondedAt ?? null,
        expiresAt: overrides.expiresAt ?? null,
    };
}

/** Quotation reference numbers a buyer would actually quote back at somebody. */
export const QUOTATION_REFERENCE_PREFIX = 'H360-Q';

function quotationLine(itemKey: string, quantity: number, priced: boolean): QuotationLine {
    const item = fromMapOrThrow(
        new Map(PROTOTYPE_CATALOGUE_ITEMS.map((candidate) => [candidate.id, candidate])),
        `catalogue-${itemKey.replace(/_/g, '-')}`,
        'catalogue item',
    );
    const unitPrice = item.contractPrice;
    return {
        catalogueItemId: item.id,
        name: item.name,
        quantity,
        quotedUnitPrice: priced ? unitPrice : null,
        quotedTotal:
            priced && unitPrice !== null
                ? currency(unitPrice.amount * quantity, unitPrice.currency)
                : null,
    };
}

/** One quotation still with the account manager, one already priced. */
export const PROTOTYPE_QUOTATIONS: readonly Quotation[] = [
    makeQuotation(
        quotationIdAt(0),
        programmeByKey('corporate_employee_package').id,
        `${QUOTATION_REFERENCE_PREFIX}-2026-0041`,
        {
            state: 'submitted',
            lines: [quotationLine('staff_lunch_box', 120, false)],
            recurring: true,
            note: 'Weekly, Monday to Thursday. Reception delivery before 11:30 please.',
            requestedAt: '2026-07-28T07:20:00.000Z',
        },
    ),
    makeQuotation(
        quotationIdAt(1),
        programmeByKey('gym_high_protein_package').id,
        `${QUOTATION_REFERENCE_PREFIX}-2026-0039`,
        {
            state: 'quoted',
            lines: [quotationLine('member_protein_plan', 60, true)],
            requestedTotal: aed(58000 * 60),
            recurring: false,
            note: 'Trial block for sixty members, four weeks.',
            requestedAt: '2026-07-21T06:05:00.000Z',
            respondedAt: '2026-07-23T12:40:00.000Z',
            expiresAt: '2026-08-20T23:59:59.000Z',
        },
    ),
];

export function quotationById(id: QuotationId): Quotation | null {
    return PROTOTYPE_QUOTATIONS.find((quotation) => quotation.id === id) ?? null;
}

/** The one deliberately non-AED line, so the multi-currency assertion has something to point at. */
export const SAR_CATALOGUE_ITEM_ID = 'catalogue-wholesale-prepared-pallet';
