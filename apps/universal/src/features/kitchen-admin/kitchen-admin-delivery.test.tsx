import { apiFailure, conflictFailure, throwFailure } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    AdminRecordMeta,
    BranchOperating,
    CursorPage,
    DeliveryWindow,
    DeliveryZoneAdmin,
    DeliveryZoneAdminFilter,
    ServiceArea,
    ServiceAreaFilter,
    SetDeliveryWindowsRequest,
} from '@healthy360/api-client/contracts';
import {
    DeliveryWindowId,
    DeliveryZoneId,
    KitchenBranchId,
    KitchenId,
    ServiceAreaId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import type { ReactNode } from 'react';

import KitchenZonesRoute from '../../../app/kitchen/delivery-zones/index.tsx';
import {
    TEST_BRANCH_ID,
    kitchenManagerSession,
    testBranch,
    testMembership,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    areaMatches,
    copyDayToOpenDays,
    groupServiceAreas,
    moneyInputState,
    moneyInputValue,
    normaliseWeekdays,
    operatingDraftsFrom,
    operatingErrors,
    operatingRequest,
    summariseOperating,
    summariseWindows,
    toggleArea,
    windowErrors,
    windowRequest,
    withDayClosed,
} from './delivery-model.ts';
import type { DeliveryWindowDraft, OperatingDayDraft } from './delivery-model.ts';
import { ServiceAreaPicker } from './delivery-row-editors.tsx';
import { ZONE_STATUS_FILTERS, zoneRowTestId } from './format.ts';
import { BranchOperatingScreen } from './screens/branch-operating-screen.tsx';
import { DeliveryZoneEditScreen } from './screens/delivery-zone-edit-screen.tsx';
import { DeliveryZonesScreen } from './screens/delivery-zones-screen.tsx';
import { KitchenHomeScreen } from './screens/kitchen-home-screen.tsx';

/**
 * The delivery half of the kitchen workspace, against a world this file declares (K1.7).
 *
 * Nothing here stubs a hook, and nothing here signs into somebody else's fixture world: every zone,
 * every gazetteer row and every trading week below is authored in this file and handed to
 * `renderStubScreen`. A repository method a screen reaches for and this file did not declare
 * rejects loudly with `StubNotConfiguredError` naming it, rather than rendering an empty state over
 * a hole in the test.
 *
 * Six things this file exists to prove, in rough order of how badly it would matter if they were
 * wrong:
 *
 * 1. **A closed day is a row, and closing one removes its fields.** The contract encodes closed as
 *    three nulls and refuses a week that is not seven rows; the editor has to produce exactly that,
 *    and a disabled-but-populated field would send a time nobody meant to keep.
 * 2. **`null` and `0` survive the round trip, separately.** "No fee recorded" and "delivery is
 *    free" are different promises to a customer. The caption says which is held, the request
 *    carries `null` for the first and `0` for the second, and the record reads back the difference.
 * 3. **The two time rules are enforced before a save, per row.** Closing before opening, and a
 *    same-day cut-off after closing time, are refused with the offending day named. A cut-off
 *    *before* opening is deliberately allowed — a meal-prep kitchen takes tomorrow's orders at 06:00
 *    and opens at 08:00 — and the test says so, because a rule nobody wrote is as expensive as a
 *    rule that is missing.
 * 4. **The area picker works at gazetteer scale.** The authored world carries four areas and the
 *    plan's production gazetteer has around 125, so the picker is asserted against a synthesised 125
 *    as well: search narrows, the cap holds, the hidden count is honest, and a chip removes what the
 *    list selected.
 * 5. **A window added here gets the server's identifier.** The set is replaced wholesale, so an
 *    editor that failed to rebase on the echo would mint a duplicate on the second save — the same
 *    defect the plan editor's variant save documents.
 * 6. **The two safety mechanisms fire here too**: a stale `lockVersion` opens the conflict dialog
 *    rather than overwriting, and leaving a dirty editor asks first.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace,
            setParams: jest.fn(),
            back: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen/delivery-zones',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
});

/** Waits for an element, with the same contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 *
 * Every builder is typed against its contract shape, so a contract that grows a required field
 * fails the typecheck here rather than producing a record the screen cannot render.
 * ---------------------------------------------------------------------------------------------- */

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000a001');
/** The kitchen branch the session's active branch resolves to — see `branch-operating-screen.tsx`. */
const BRANCH_ID = KitchenBranchId.unsafe(String(TEST_BRANCH_ID));

/** UUID-shaped, because `DeliveryZoneEditScreen` parses the route parameter with `DeliveryZoneId`. */
function zoneId(ordinal: number): DeliveryZoneId {
    return DeliveryZoneId.unsafe(`01935f6d-0000-7000-8000-00000000e00${String(ordinal)}`);
}

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'draft',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

function recordMeta(overrides: Partial<AdminRecordMeta> = {}): AdminRecordMeta {
    return {
        lockVersion: 1,
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

function serviceArea(ordinal: number, overrides: Partial<ServiceArea> = {}): ServiceArea {
    return {
        id: ServiceAreaId.unsafe(`01935f6d-0000-7000-8000-00000000f00${String(ordinal)}`),
        name: { en: `District ${String(ordinal)}`, ar: `حي ${String(ordinal)}` },
        countryCode: 'AE',
        parentName: { en: 'Dubai', ar: 'دبي' },
        isActive: true,
        ...overrides,
    };
}

/** The gazetteer this world publishes. Four rows: two on the zone, two it may still reach for. */
const GAZETTEER: readonly ServiceArea[] = [
    serviceArea(1),
    serviceArea(2),
    serviceArea(3, { parentName: { en: 'Sharjah', ar: 'الشارقة' } }),
    serviceArea(4, { parentName: { en: 'Sharjah', ar: 'الشارقة' }, isActive: false }),
];

/**
 * A row from another market, which the platform gazetteer really does carry.
 *
 * `delivery_areas` has no `organisation_id` — the committed rows are Lebanese and a demo tenant's
 * are Emirati — while `setZoneAreas` refuses an area outside the organisation's own country. So an
 * unscoped read is not a harmless extra option: it is a checkbox whose save cannot succeed.
 */
const FOREIGN_AREA: ServiceArea = serviceArea(9, {
    name: { en: 'Achrafieh', ar: 'الأشرفية' },
    countryCode: 'LB',
    parentName: { en: 'Beirut', ar: 'بيروت' },
});

function deliveryWindow(ordinal: number, overrides: Partial<DeliveryWindow> = {}): DeliveryWindow {
    return {
        id: DeliveryWindowId.unsafe(
            `01935f6d-0000-7000-8000-000000010${String(ordinal).padStart(3, '0')}`,
        ),
        label: { en: `Window ${String(ordinal)}`, ar: `نافذة ${String(ordinal)}` },
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        startsAt: '08:00',
        endsAt: '11:00',
        capacity: null,
        isActive: true,
        ...overrides,
    };
}

function zone(ordinal: number, overrides: Partial<DeliveryZoneAdmin> = {}): DeliveryZoneAdmin {
    return {
        id: zoneId(ordinal),
        meta: meta(),
        name: { en: `Ring ${String(ordinal)}`, ar: `حلقة ${String(ordinal)}` },
        kitchenId: KITCHEN_ID,
        branchIds: [BRANCH_ID],
        areas: [],
        deliveryFeeMinor: null,
        minimumOrderMinor: null,
        currency: 'USD',
        estimatedMinutes: null,
        deliveryWindows: [],
        ...overrides,
    };
}

/**
 * The zone every editor assertion is written against: two areas, two windows, a fee and a minimum.
 *
 * The first window covers the whole week on purpose — the weekday test toggles Sunday off it, and a
 * window that never reached Sunday would make the toggle indistinguishable from a broken control.
 */
const SEEDED_ZONE: DeliveryZoneAdmin = zone(1, {
    meta: meta({ status: 'published', lockVersion: 2 }),
    name: { en: 'Marina ring', ar: 'حلقة المارينا' },
    areas: [GAZETTEER[0]!, GAZETTEER[1]!],
    deliveryFeeMinor: 1500,
    minimumOrderMinor: 5000,
    estimatedMinutes: 45,
    deliveryWindows: [
        deliveryWindow(1),
        deliveryWindow(2, {
            label: { en: 'Evening', ar: 'مساء' },
            weekdays: [1, 2, 3],
            startsAt: '17:00',
            endsAt: '20:00',
        }),
    ],
});

/** A zone nobody has decided a fee for: `null`, which is not zero and must not read as one. */
const UNDECIDED_ZONE: DeliveryZoneAdmin = zone(2, {
    name: { en: 'Undecided ring', ar: 'حلقة غير محسومة' },
});

/** A zone whose fee is a decided zero: free delivery, and somebody chose it. */
const FREE_ZONE: DeliveryZoneAdmin = zone(3, {
    name: { en: 'Free ring', ar: 'حلقة مجانية' },
    deliveryFeeMinor: 0,
    minimumOrderMinor: 0,
});

/** The branch's trading week: open Monday to Friday, shut at the weekend. */
const BRANCH_OPERATING: BranchOperating = {
    branchId: BRANCH_ID,
    meta: recordMeta(),
    timeZone: 'Asia/Dubai',
    days: [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
        weekday <= 5
            ? { weekday, opensAt: '08:00', closesAt: '22:00', orderCutOffAt: '18:00' }
            : { weekday, opensAt: null, closesAt: null, orderCutOffAt: null },
    ),
};

/**
 * The zone listing, answering the filters the screens actually send.
 *
 * `query` and `statuses` are real server filters (`DeliveryZoneAdminFilter`), and three call sites
 * depend on them behaving: the list screen's search box, the hub card's per-status counts, and the
 * editor's currency derivation. Reading a getter rather than a captured array is what lets a test
 * move the world on mid-flight and assert the refetch.
 */
function zoneListing(
    read: () => readonly DeliveryZoneAdmin[],
): (filter?: DeliveryZoneAdminFilter) => Promise<CursorPage<DeliveryZoneAdmin>> {
    return async (filter) => {
        const statuses = filter?.statuses;
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';

        return page(
            read().filter(
                (row) =>
                    (statuses === undefined || statuses.includes(row.meta.status)) &&
                    (needle === '' ||
                        row.name.en.toLocaleLowerCase().includes(needle) ||
                        row.name.ar.includes(needle)),
            ),
        );
    };
}

/**
 * The gazetteer read, honouring the one filter the endpoint applies itself.
 *
 * `country_code` is a real server filter, so the stub applies it rather than answering every row to
 * every caller — a picker that reads unscoped would otherwise pass here and offer a manager places
 * their zone can never cover.
 */
function gazetteerListing(
    read: () => readonly ServiceArea[] = () => GAZETTEER,
): (filter?: ServiceAreaFilter) => Promise<CursorPage<ServiceArea>> {
    return async (filter) => {
        const country = filter?.countryCode;
        return page(read().filter((area) => country === undefined || area.countryCode === country));
    };
}

/**
 * Everything the zone editor reads before it can render anything.
 *
 * All four fire on every render of the editor, including the create form and the not-found state —
 * the queries start before the route parameter is judged — so they are declared together rather
 * than per test.
 */
function zoneEditorReads(
    read: () => DeliveryZoneAdmin,
    zones: () => readonly DeliveryZoneAdmin[] = () => [read()],
) {
    return {
        getZone: async () => read(),
        listZones: zoneListing(zones),
        listPriceLists: async () => page([]),
        listServiceAreas: gazetteerListing(),
    };
}

/** The same four, for the create form and the not-found state, where there is no record to read. */
function zonelessEditorReads() {
    return {
        listZones: zoneListing(() => [SEEDED_ZONE]),
        listPriceLists: async () => page([]),
        listServiceAreas: gazetteerListing(),
    };
}

/** The server's rule for a wholesale window write: a `null` identifier comes back with one. */
function mintWindows(
    record: DeliveryZoneAdmin,
    request: SetDeliveryWindowsRequest,
): DeliveryZoneAdmin {
    let minted = 0;
    return {
        ...record,
        deliveryWindows: request.windows.map((input) => {
            minted += 1;
            return {
                id:
                    input.id ??
                    DeliveryWindowId.unsafe(
                        `01935f6d-0000-7000-8000-0000000209${String(minted).padStart(2, '0')}`,
                    ),
                label: input.label,
                weekdays: input.weekdays,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                capacity: input.capacity ?? null,
                isActive: input.isActive ?? true,
            };
        }),
        meta: { ...record.meta, lockVersion: request.lockVersion + 1 },
    };
}

/**
 * Everything the hub reads.
 *
 * The kitchen manager holds every workspace permission, so the grid renders every family and each
 * card fetches its own summary. Declaring all of them is the point of the harness: a card whose
 * listing this file forgot would reject with `StubNotConfiguredError` naming it, rather than
 * quietly rendering "Count unavailable" over a hole in the test.
 */
function hubRepositories(zones: readonly DeliveryZoneAdmin[]): RepositoryOverrides {
    return {
        kitchenAdmin: {
            listIngredients: async () => page([]),
            listRecipes: async () => page([]),
            listProducts: async () => page([]),
            listMeals: async () => page([]),
            listPlans: async () => page([]),
            listPriceLists: async () => page([]),
            listZones: zoneListing(() => zones),
            listAllergenClasses: async () => [],
            getBranchOperating: async () => BRANCH_OPERATING,
        },
        kitchenOps: {
            countLowStockLevels: async () => 0,
            countUnresolvedConsumptionExceptions: async () => 0,
        },
    };
}

/**
 * A kitchen manager whose membership names the branch in context.
 *
 * `BranchOperatingScreen` reads the branch's *name* off `me()` rather than fetching it, so a
 * membership with no branches would render the honest "unknown branch" badge instead of the one a
 * person actually sees.
 */
function kitchenSession() {
    return kitchenManagerSession({
        memberships: [testMembership({ branches: [testBranch()] })],
    });
}

/* ------------------------------------------------------------------------------------------------
 * Pure helpers
 * ---------------------------------------------------------------------------------------------- */

function windowRow(overrides: Partial<DeliveryWindowDraft> = {}): DeliveryWindowDraft {
    return {
        key: 'w1',
        id: null,
        label: { en: 'Morning', ar: 'صباح' },
        weekdays: [1, 2, 3, 4, 5],
        startsAt: '08:00',
        endsAt: '11:00',
        capacity: '',
        isActive: true,
        ...overrides,
    };
}

function openDay(weekday: number, overrides: Partial<OperatingDayDraft> = {}): OperatingDayDraft {
    return {
        weekday,
        isClosed: false,
        opensAt: '08:00',
        closesAt: '22:00',
        orderCutOffAt: '18:00',
        ...overrides,
    };
}

const WINDOW_MESSAGES = {
    labelRequired: 'label',
    weekdaysRequired: 'weekdays',
    startInvalid: 'start',
    endInvalid: 'end',
    endBeforeStart: 'order',
    capacityInvalid: 'capacity',
};

const DAY_MESSAGES = {
    opensInvalid: 'opens',
    closesInvalid: 'closes',
    closesBeforeOpens: 'order',
    cutOffInvalid: 'cut-off',
    cutOffAfterCloses: 'late',
};

/** A synthesised gazetteer at the scale the plan states — 125 names across five governorates. */
function largeGazetteer(): readonly ServiceArea[] {
    const parents = ['Dubai', 'Sharjah', 'Ajman', 'Abu Dhabi', 'Ras Al Khaimah'];
    return Array.from({ length: 125 }, (_, index) => ({
        id: ServiceAreaId.unsafe(`area-${String(index)}`),
        name: { en: `District ${String(index + 1)}`, ar: `حي ${String(index + 1)}` },
        countryCode: 'AE',
        parentName: {
            en: parents[index % parents.length] ?? 'Dubai',
            ar: parents[index % parents.length] ?? 'Dubai',
        },
        isActive: index % 20 !== 0,
    }));
}

/* ------------------------------------------------------------------------------------------------
 * The model
 * ---------------------------------------------------------------------------------------------- */

describe('the delivery model', () => {
    it('normalises a weekday set into ISO order without duplicates or strays', () => {
        expect(normaliseWeekdays([7, 1, 1, 3])).toEqual([1, 3, 7]);
        expect(normaliseWeekdays([0, 8, 4.5, 2])).toEqual([2]);
        expect(normaliseWeekdays([])).toEqual([]);
    });

    it('tells an unrecorded amount from a decided zero', () => {
        expect(moneyInputState('', 'USD')).toBe('unset');
        expect(moneyInputState('   ', 'USD')).toBe('unset');
        expect(moneyInputState('0', 'USD')).toBe('zero');
        expect(moneyInputState('0.00', 'USD')).toBe('zero');
        expect(moneyInputState('9.50', 'USD')).toBe('amount');
        expect(moneyInputState('9.505', 'USD')).toBe('invalid');
        expect(moneyInputState('nine', 'USD')).toBe('invalid');

        // And the value that follows from each: `null` for both absences, `0` only for the decision.
        expect(moneyInputValue('', 'USD')).toBeNull();
        expect(moneyInputValue('0', 'USD')).toBe(0);
        expect(moneyInputValue('9.50', 'USD')).toBe(950);
        expect(moneyInputValue('nine', 'USD')).toBeNull();
    });

    it('refuses a window that is unlabelled, undated, mistyped or backwards', () => {
        expect(windowErrors([windowRow()], WINDOW_MESSAGES).size).toBe(0);

        const label = windowErrors(
            [windowRow({ label: { en: ' ', ar: 'صباح' } })],
            WINDOW_MESSAGES,
        );
        expect(label.get('w1')).toBe('label');

        const days = windowErrors([windowRow({ weekdays: [] })], WINDOW_MESSAGES);
        expect(days.get('w1')).toBe('weekdays');

        const start = windowErrors([windowRow({ startsAt: '25:00' })], WINDOW_MESSAGES);
        expect(start.get('w1')).toBe('start');

        // Equal times are not a window, and a window may not cross midnight — the contract carries
        // two wall-clock times and no day offset.
        const equal = windowErrors(
            [windowRow({ startsAt: '11:00', endsAt: '11:00' })],
            WINDOW_MESSAGES,
        );
        expect(equal.get('w1')).toBe('order');
        const overnight = windowErrors(
            [windowRow({ startsAt: '22:00', endsAt: '02:00' })],
            WINDOW_MESSAGES,
        );
        expect(overnight.get('w1')).toBe('order');

        const capacity = windowErrors([windowRow({ capacity: '0' })], WINDOW_MESSAGES);
        expect(capacity.get('w1')).toBe('capacity');
    });

    it('sends a window with padded times and an uncapped capacity as null', () => {
        const [request] = windowRequest([windowRow({ startsAt: '8:00', capacity: '' })]);
        expect(request?.startsAt).toBe('08:00');
        expect(request?.capacity).toBeNull();

        const [capped] = windowRequest([windowRow({ capacity: '40' })]);
        expect(capped?.capacity).toBe(40);
    });

    it('always produces seven operating rows, filling anything the server omitted as closed', () => {
        const partial: BranchOperating = {
            branchId: KitchenBranchId.unsafe('branch'),
            meta: { lockVersion: 1, updatedAt: '2026-01-01T00:00:00Z', updatedByName: null },
            timeZone: 'Asia/Dubai',
            days: [
                { weekday: 1, opensAt: '08:00', closesAt: '22:00', orderCutOffAt: '18:00' },
                { weekday: 5, opensAt: null, closesAt: null, orderCutOffAt: null },
            ],
        };

        const rows = operatingDraftsFrom(partial);
        expect(rows).toHaveLength(7);
        expect(rows.map((row) => row.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(rows[0]?.isClosed).toBe(false);
        expect(rows[4]?.isClosed).toBe(true);
        // A weekday the response never mentioned is closed, not missing.
        expect(rows[1]?.isClosed).toBe(true);
    });

    it('clears the times when a day is closed, rather than hiding them behind a disabled field', () => {
        const closed = withDayClosed(openDay(3), true);
        expect(closed).toEqual({
            weekday: 3,
            isClosed: true,
            opensAt: '',
            closesAt: '',
            orderCutOffAt: '',
        });

        // Re-opening starts empty. Nobody has said when this day trades, and prefilling would be
        // the editor inventing an answer.
        const reopened = withDayClosed(closed, false);
        expect(reopened.opensAt).toBe('');
        expect(reopened.isClosed).toBe(false);
    });

    it('enforces closing after opening and a cut-off no later than closing — and nothing else', () => {
        expect(operatingErrors([openDay(1)], DAY_MESSAGES).size).toBe(0);

        const backwards = operatingErrors(
            [openDay(1, { opensAt: '22:00', closesAt: '08:00' })],
            DAY_MESSAGES,
        );
        expect(backwards.get(1)).toBe('order');

        const equal = operatingErrors(
            [openDay(1, { opensAt: '10:00', closesAt: '10:00' })],
            DAY_MESSAGES,
        );
        expect(equal.get(1)).toBe('order');

        const lateCutOff = operatingErrors([openDay(2, { orderCutOffAt: '23:00' })], DAY_MESSAGES);
        expect(lateCutOff.get(2)).toBe('late');

        // Deliberately legal: a meal-prep kitchen takes same-day orders before it opens its doors.
        expect(operatingErrors([openDay(3, { orderCutOffAt: '06:00' })], DAY_MESSAGES).size).toBe(
            0,
        );
        // And a blank cut-off is legal too — it means the day has none.
        expect(operatingErrors([openDay(4, { orderCutOffAt: '' })], DAY_MESSAGES).size).toBe(0);

        // A closed day is never validated: there is nothing on it to be wrong.
        expect(
            operatingErrors(
                [withDayClosed(openDay(5, { opensAt: 'nonsense' }), true)],
                DAY_MESSAGES,
            ).size,
        ).toBe(0);
    });

    it('sends a closed day as three nulls and the week in weekday order', () => {
        const rows = [
            openDay(3),
            withDayClosed(openDay(1), true),
            openDay(2, { orderCutOffAt: '' }),
        ];
        const request = operatingRequest(rows);

        expect(request.map((day) => day.weekday)).toEqual([1, 2, 3]);
        expect(request[0]).toEqual({
            weekday: 1,
            opensAt: null,
            closesAt: null,
            orderCutOffAt: null,
        });
        // A blank cut-off on an open day is `null`, and the two other times are still there.
        expect(request[1]).toEqual({
            weekday: 2,
            opensAt: '08:00',
            closesAt: '22:00',
            orderCutOffAt: null,
        });
    });

    it('copies one day onto the open days and leaves the closed ones shut', () => {
        const rows = [
            openDay(1, { opensAt: '09:00', closesAt: '21:00', orderCutOffAt: '17:00' }),
            openDay(2),
            withDayClosed(openDay(3), true),
        ];

        const copied = copyDayToOpenDays(rows, 1);
        expect(copied[1]?.opensAt).toBe('09:00');
        expect(copied[1]?.orderCutOffAt).toBe('17:00');
        expect(copied[2]?.isClosed).toBe(true);
        expect(copied[2]?.opensAt).toBe('');

        // Copying *from* a closed day changes nothing: there is nothing to copy.
        expect(copyDayToOpenDays(rows, 3)).toBe(rows);
    });

    it('summarises a trading week and a delivery week from what is on screen', () => {
        const week = [
            openDay(1),
            openDay(2, { orderCutOffAt: '' }),
            withDayClosed(openDay(3), true),
        ];
        expect(summariseOperating(week)).toEqual({ openDays: 2, closedDays: 1, withCutOff: 1 });

        const coverage = summariseWindows([
            { weekdays: [1, 2, 3], isActive: true },
            { weekdays: [3, 6], isActive: true },
            { weekdays: [7], isActive: false },
        ]);
        expect(coverage).toEqual({ total: 3, active: 2, weekdays: [1, 2, 3, 6] });
    });

    it('searches the gazetteer across both languages, the parent, and without diacritics', () => {
        const areas = largeGazetteer();
        const first = areas[0];
        if (first === undefined) throw new Error('The synthesised gazetteer is empty.');

        expect(areaMatches(first, 'district 1')).toBe(true);
        expect(areaMatches(first, 'حي ١')).toBe(false);
        expect(areaMatches(first, first.name.ar)).toBe(true);
        // The parent is searchable, which is how "everything in Sharjah" is asked for.
        expect(areas.filter((area) => areaMatches(area, 'Sharjah'))).toHaveLength(25);
        expect(areas.filter((area) => areaMatches(area, ''))).toHaveLength(125);
    });

    it('groups the gazetteer by parent and keeps a selection in gazetteer order', () => {
        const areas = largeGazetteer();
        const groups = groupServiceAreas(areas);
        expect(groups).toHaveLength(5);
        expect(groups.reduce((total, group) => total + group.areas.length, 0)).toBe(125);

        const third = areas[2]?.id;
        const first = areas[0]?.id;
        if (third === undefined || first === undefined) throw new Error('Gazetteer too short.');

        // Chosen out of order, held in gazetteer order — so the chips never jump under the reader.
        const selected = toggleArea(toggleArea([], third, true, areas), first, true, areas);
        expect(selected).toEqual([first, third]);
        expect(toggleArea(selected, first, false, areas)).toEqual([third]);
        // Selecting the same row twice is not two selections.
        expect(toggleArea(selected, third, true, areas)).toEqual(selected);
    });

    it('offers only the statuses this family can actually reach', () => {
        // There is no `publishZone` on the contract, so nothing can quarantine a zone and a
        // `review_required` chip would never match a row.
        expect([...ZONE_STATUS_FILTERS]).toEqual(['draft', 'published', 'retired']);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The zone list
 * ---------------------------------------------------------------------------------------------- */

describe('the delivery-zone list', () => {
    it('renders skeletons, then the authored zones with their areas, windows and charges', async () => {
        // A visible latency, so the pending frame is deterministically observable rather than a
        // race against a stub that resolves on a microtask.
        await renderStubScreen(<DeliveryZonesScreen />, {
            session: kitchenSession(),
            latencyMs: 40,
            repositories: {
                kitchenAdmin: { listZones: zoneListing(() => [SEEDED_ZONE, UNDECIDED_ZONE]) },
            },
        });

        await untilVisible('kitchen-zones-loading');
        await untilVisible('kitchen-zones-table');

        const row = zoneRowTestId(String(SEEDED_ZONE.id));
        expect(screen.getByTestId(`${row}-name`)).toBeTruthy();
        // Two areas and two windows, which is what this file authored onto the zone.
        expect(screen.getByTestId(`${row}-area-count`)).toHaveTextContent(/2/);
        expect(screen.getByTestId(`${row}-window-count`)).toHaveTextContent(/2/);
        expect(screen.getByTestId(`${row}-status`)).toBeTruthy();
    });

    it('states an unrecorded fee as an absence rather than as a zero', async () => {
        await renderStubScreen(<DeliveryZonesScreen />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: { listZones: zoneListing(() => [SEEDED_ZONE, UNDECIDED_ZONE]) },
            },
        });
        await untilVisible('kitchen-zones-table');

        const row = zoneRowTestId(String(UNDECIDED_ZONE.id));

        // `null` is "nothing recorded". The word "free" must not appear for it, because a free
        // delivery is a decision somebody made and this is the absence of one.
        expect(screen.getByTestId(`${row}-fee`)).toHaveTextContent(/no fee recorded/i);
        expect(screen.getByTestId(`${row}-minimum`)).toHaveTextContent(/no minimum recorded/i);
        expect(screen.getByTestId(`${row}-areas-none`)).toBeTruthy();
        expect(screen.getByTestId(`${row}-windows-none`)).toBeTruthy();
    });

    it('states a decided zero fee as free', async () => {
        await renderStubScreen(<DeliveryZonesScreen />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: { listZones: zoneListing(() => [SEEDED_ZONE, FREE_ZONE]) },
            },
        });
        await untilVisible('kitchen-zones-table');

        const row = zoneRowTestId(String(FREE_ZONE.id));

        expect(screen.getByTestId(`${row}-fee`)).toHaveTextContent(/free/i);
        expect(screen.getByTestId(`${row}-fee`)).not.toHaveTextContent(/no fee recorded/i);
    });

    it('separates a filtered empty result from an empty kitchen', async () => {
        await renderStubScreen(<DeliveryZonesScreen />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: { listZones: zoneListing(() => [SEEDED_ZONE, UNDECIDED_ZONE]) },
            },
        });
        await untilVisible('kitchen-zones-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-zones-toolbar-search-input'),
                'no such zone anywhere',
            );
        });

        await untilVisible('kitchen-zones-empty');
        expect(screen.getByTestId('kitchen-zones-empty')).toHaveTextContent(/filters/i);
    });

    it('renders the error state when the listing fails', async () => {
        await renderStubScreen(<DeliveryZonesScreen />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: {
                    listZones: async () => throwFailure(apiFailure('server', { message: 'Boom.' })),
                },
            },
        });

        await untilVisible('kitchen-zones-error');
    });

    it('renders through the code-split route as well as directly', async () => {
        await renderStubScreen(<KitchenZonesRoute />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: { listZones: zoneListing(() => [SEEDED_ZONE]) },
            },
        });
        await untilVisible('kitchen-zones-screen');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The zone editor
 * ---------------------------------------------------------------------------------------------- */

describe('the delivery-zone editor', () => {
    it('says which of the three money states each field is holding', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone={String(SEEDED_ZONE.id)} />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: zoneEditorReads(() => SEEDED_ZONE) },
        });
        await untilVisible('kitchen-zone-editor-screen');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-fee-input'), '');
        });
        expect(screen.getByTestId('kitchen-zone-fee-state')).toHaveTextContent(
            /not the same as free/i,
        );

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-fee-input'), '0');
        });
        expect(screen.getByTestId('kitchen-zone-fee-state')).toHaveTextContent(/free delivery/i);

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-fee-input'), '12.50');
        });
        expect(screen.getByTestId('kitchen-zone-fee-state')).toHaveTextContent(/a charge/i);

        // A typo blocks the save rather than silently sending `null` and erasing the fee.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-fee-input'), '12.505');
        });
        expect(
            screen.getByTestId('kitchen-zone-editor-screen-save').props.accessibilityState,
        ).toEqual(expect.objectContaining({ disabled: true }));
    });

    it('writes an emptied fee back as null rather than as zero', async () => {
        let stored: DeliveryZoneAdmin = SEEDED_ZONE;

        const { repositories } = await renderStubScreen(
            <DeliveryZoneEditScreen zone={String(SEEDED_ZONE.id)} />,
            {
                session: kitchenSession(),
                repositories: {
                    kitchenAdmin: {
                        ...zoneEditorReads(
                            () => stored,
                            () => [stored],
                        ),
                        updateZone: async (_id, request) => {
                            stored = {
                                ...stored,
                                ...(request.name === undefined ? {} : { name: request.name }),
                                deliveryFeeMinor: request.deliveryFeeMinor ?? null,
                                minimumOrderMinor: request.minimumOrderMinor ?? null,
                                estimatedMinutes: request.estimatedMinutes ?? null,
                                meta: { ...stored.meta, lockVersion: request.lockVersion + 1 },
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-zone-editor-screen');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-fee-input'), '');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-editor-screen-save'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.updateZone).toHaveBeenNthCalledWith(
                1,
                SEEDED_ZONE.id,
                expect.objectContaining({
                    lockVersion: SEEDED_ZONE.meta.lockVersion,
                    deliveryFeeMinor: null,
                }),
            );
        });
        await waitFor(() => {
            expect(stored.deliveryFeeMinor).toBeNull();
        });

        // And a typed zero is a zero, not another absence.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-fee-input'), '0');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-editor-screen-save'));
        });

        await waitFor(() => {
            expect(stored.deliveryFeeMinor).toBe(0);
        });
        expect(repositories.kitchenAdmin.updateZone).toHaveBeenNthCalledWith(
            2,
            SEEDED_ZONE.id,
            expect.objectContaining({ deliveryFeeMinor: 0 }),
        );
    });

    it('adds and removes gazetteer areas, and saves the set', async () => {
        let stored: DeliveryZoneAdmin = SEEDED_ZONE;

        await renderStubScreen(<DeliveryZoneEditScreen zone={String(SEEDED_ZONE.id)} />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: {
                    ...zoneEditorReads(
                        () => stored,
                        () => [stored],
                    ),
                    setZoneAreas: async (_id, request) => {
                        stored = {
                            ...stored,
                            areas: request.serviceAreaIds.flatMap((areaId) =>
                                GAZETTEER.filter((area) => area.id === areaId),
                            ),
                            meta: { ...stored.meta, lockVersion: request.lockVersion + 1 },
                        };
                        return stored;
                    },
                },
            },
        });
        await untilVisible('kitchen-zone-area-picker-search');

        const target = GAZETTEER.find(
            (area) => !SEEDED_ZONE.areas.some((existing) => existing.id === area.id),
        );
        if (target === undefined) throw new Error('Every gazetteer row is already on the zone.');

        await act(async () => {
            fireEvent.press(
                screen.getByTestId(`kitchen-zone-area-picker-option-${String(target.id)}-control`),
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-areas-save'));
        });

        await waitFor(() => {
            expect(stored.areas.map((area) => String(area.id))).toContain(String(target.id));
        });

        // The chip is the other way out, and it removes what the checkbox added.
        await act(async () => {
            fireEvent.press(
                screen.getByTestId(`kitchen-zone-area-picker-chip-${String(target.id)}-remove`),
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-areas-save'));
        });

        await waitFor(() => {
            expect(stored.areas.map((area) => String(area.id))).not.toContain(String(target.id));
        });
    });

    /**
     * The picker asks for one country: the one its own organisation operates in.
     *
     * `setZoneAreas` refuses an area from anywhere else (`area_country_mismatch`), and the gazetteer
     * is a platform table spanning every market the platform has opened — so a picker that read it
     * whole would offer checkboxes whose save is refused, which is what a real API run found. The
     * country comes off the session's membership, and the assertion is on both halves: the request
     * carries it, and the foreign row never becomes an option.
     */
    it('offers the gazetteer of its own organisation’s country and no other', async () => {
        const listServiceAreas = jest.fn(gazetteerListing(() => [...GAZETTEER, FOREIGN_AREA]));

        await renderStubScreen(<DeliveryZoneEditScreen zone={String(SEEDED_ZONE.id)} />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: {
                    ...zoneEditorReads(() => SEEDED_ZONE),
                    listServiceAreas,
                },
            },
        });
        await untilVisible('kitchen-zone-area-picker-search');

        expect(listServiceAreas).toHaveBeenCalledWith(
            expect.objectContaining({ countryCode: 'AE' }),
        );

        const local = GAZETTEER[2];
        if (local === undefined) throw new Error('The authored gazetteer is empty.');
        expect(
            screen.queryByTestId(`kitchen-zone-area-picker-option-${String(local.id)}-control`),
        ).toBeTruthy();
        expect(
            screen.queryByTestId(
                `kitchen-zone-area-picker-option-${String(FOREIGN_AREA.id)}-control`,
            ),
        ).toBeNull();
    });

    it('toggles a window weekday and saves the set, minting an identifier for a new row', async () => {
        let stored: DeliveryZoneAdmin = SEEDED_ZONE;

        await renderStubScreen(<DeliveryZoneEditScreen zone={String(SEEDED_ZONE.id)} />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: {
                    ...zoneEditorReads(
                        () => stored,
                        () => [stored],
                    ),
                    setDeliveryWindows: async (_id, request) => {
                        stored = mintWindows(stored, request);
                        return stored;
                    },
                },
            },
        });
        await untilVisible('kitchen-zone-window-rows');

        const firstWindow = SEEDED_ZONE.deliveryWindows[0]!;
        const rowId = `kitchen-zone-window-rows-row-seed-window-0-${String(firstWindow.id)}`;

        // Sunday off, in ISO terms: weekday 7.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${rowId}-weekday-7`));
        });

        // A brand-new window, which goes up with a null identifier and comes back with one.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-window-rows-add'));
        });
        // One field per `act`: each change is applied against the state the previous one produced,
        // and batching them would make the last write win over its own siblings.
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-zone-window-rows-row-window-1-label-en-input'),
                'Late evening',
            );
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-zone-window-rows-row-window-1-starts-input'),
                '19:00',
            );
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-zone-window-rows-row-window-1-ends-input'),
                '21:30',
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-windows-save'));
        });

        await waitFor(() => {
            expect(stored.deliveryWindows).toHaveLength(SEEDED_ZONE.deliveryWindows.length + 1);
            const added = stored.deliveryWindows.find((row) => row.label.en === 'Late evening');
            expect(added?.startsAt).toBe('19:00');
            expect(String(added?.id ?? '')).not.toBe('');
            expect(
                stored.deliveryWindows.find((row) => String(row.id) === String(firstWindow.id))
                    ?.weekdays,
            ).not.toContain(7);
        });
    });

    it('blocks the window save while a row is backwards, and names the row', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone={String(SEEDED_ZONE.id)} />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: zoneEditorReads(() => SEEDED_ZONE) },
        });
        await untilVisible('kitchen-zone-window-rows');

        const firstWindow = SEEDED_ZONE.deliveryWindows[0]!;
        const rowId = `kitchen-zone-window-rows-row-seed-window-0-${String(firstWindow.id)}`;

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${rowId}-starts-input`), '22:00');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${rowId}-ends-input`), '02:00');
        });

        expect(screen.getByTestId(`${rowId}-error`)).toBeTruthy();
        expect(screen.getByTestId('kitchen-zone-windows-save').props.accessibilityState).toEqual(
            expect.objectContaining({ disabled: true }),
        );
    });

    it('offers reload-or-keep when somebody else has moved the zone on', async () => {
        let stored: DeliveryZoneAdmin = SEEDED_ZONE;

        const { repositories } = await renderStubScreen(
            <DeliveryZoneEditScreen zone={String(SEEDED_ZONE.id)} />,
            {
                session: kitchenSession(),
                repositories: {
                    kitchenAdmin: {
                        ...zoneEditorReads(
                            () => stored,
                            () => [stored],
                        ),
                        updateZone: async (_id, request) => {
                            // The server's rule: a stale `lockVersion` is refused rather than
                            // applied over whatever landed in between.
                            if (request.lockVersion !== stored.meta.lockVersion) {
                                throwFailure(
                                    conflictFailure({
                                        currentLockVersion: stored.meta.lockVersion,
                                    }),
                                );
                            }
                            stored = {
                                ...stored,
                                ...(request.name === undefined ? {} : { name: request.name }),
                                meta: { ...stored.meta, lockVersion: request.lockVersion + 1 },
                            };
                            return stored;
                        },
                    },
                },
            },
        );
        await untilVisible('kitchen-zone-editor-screen');

        // Somebody else saves the same row: the editor now holds a superseded version, which is
        // exactly the state `If-Match` exists to detect.
        stored = {
            ...stored,
            estimatedMinutes: 99,
            meta: { ...stored.meta, lockVersion: stored.meta.lockVersion + 1 },
        };

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-name-en-input'), 'My version');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-editor-screen-save'));
        });

        await untilVisible('kitchen-zone-editor-screen-conflict-dialog');

        // One attempt, refused: the other tab's write stands and nothing was overwritten.
        expect(repositories.kitchenAdmin.updateZone).toHaveBeenCalledTimes(1);
        expect(stored.name.en).toBe(SEEDED_ZONE.name.en);
        expect(stored.estimatedMinutes).toBe(99);
    });

    it('asks before leaving with unsaved changes', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone={String(SEEDED_ZONE.id)} />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: zoneEditorReads(() => SEEDED_ZONE) },
        });
        await untilVisible('kitchen-zone-editor-screen');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-name-en-input'), 'Half typed');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-editor-screen-back'));
        });

        await untilVisible('kitchen-zone-editor-screen-unsaved-dialog');
        expect(routerMock.__push).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-editor-screen-unsaved-discard'));
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/delivery-zones');
        });
    });

    it('states what archiving costs, counted from the record', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone={String(SEEDED_ZONE.id)} />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: zoneEditorReads(() => SEEDED_ZONE) },
        });
        await untilVisible('kitchen-zone-editor-screen');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-zone-archive'));
        });

        await untilVisible('kitchen-zone-archive-dialog');
        // Counted from what this file authored: one branch, two areas, two windows.
        expect(screen.getByTestId('kitchen-zone-archive-branches')).toHaveTextContent(/1/);
        expect(screen.getByTestId('kitchen-zone-archive-areas')).toHaveTextContent(/2/);
        expect(screen.getByTestId('kitchen-zone-archive-windows')).toHaveTextContent(/2/);
    });

    it('offers no area or window editor before the zone exists', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone="new" />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: zonelessEditorReads() },
        });
        await untilVisible('kitchen-zone-editor-screen');

        expect(screen.getByTestId('kitchen-zone-areas-unavailable')).toBeTruthy();
        expect(screen.getByTestId('kitchen-zone-windows-unavailable')).toBeTruthy();
        // The currency is chosen on the create form and stated afterwards.
        expect(screen.getByTestId('kitchen-zone-currency-select')).toBeTruthy();
    });

    it('renders the designed not-found state for a hand-typed identifier', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone="not-a-uuid" />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: zonelessEditorReads() },
        });
        await untilVisible('kitchen-zone-not-found');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The gazetteer picker, at scale
 * ---------------------------------------------------------------------------------------------- */

function PickerHarness({ gazetteer }: { readonly gazetteer: readonly ServiceArea[] }) {
    const [selected, setSelected] = useState<readonly ServiceAreaId[]>([]);
    return (
        <ServiceAreaPicker
            testID="picker"
            gazetteer={gazetteer}
            selected={selected}
            onChange={setSelected}
            canManage
            locale="en"
            truncated={false}
        />
    );
}

describe('the service-area picker at gazetteer scale', () => {
    it('caps the list, says how many are hidden, and narrows on search', async () => {
        const gazetteer = largeGazetteer();
        // No repository overrides: the picker is handed its gazetteer as a prop, so a version that
        // started fetching would fail here with StubNotConfiguredError.
        await renderStubScreen(<PickerHarness gazetteer={gazetteer} />, {
            session: kitchenSession(),
        });
        await untilVisible('picker-search');

        // 125 rows, 40 drawn: the count is honest about both halves.
        expect(screen.getByTestId('picker-count')).toHaveTextContent(/125 of 125/);
        expect(screen.getByTestId('picker-more')).toHaveTextContent(/85/);
        expect(screen.queryByTestId('picker-option-area-0')).toBeTruthy();
        expect(screen.queryByTestId('picker-option-area-100')).toBeNull();

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('picker-search-input'), 'District 101');
        });

        expect(screen.queryByTestId('picker-option-area-100')).toBeTruthy();
        expect(screen.queryByTestId('picker-more')).toBeNull();
    });

    it('keeps a chosen area reachable after the search moves past it', async () => {
        const gazetteer = largeGazetteer();
        await renderStubScreen(<PickerHarness gazetteer={gazetteer} />, {
            session: kitchenSession(),
        });
        await untilVisible('picker-search');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('picker-search-input'), 'District 101');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('picker-option-area-100-control'));
        });

        // Clear the search: the chosen row is past the cap, and is drawn anyway — otherwise it
        // could never be unselected from the list.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('picker-search-input'), '');
        });
        expect(screen.queryByTestId('picker-option-area-100')).toBeTruthy();
        expect(screen.getByTestId('picker-chip-area-100')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('picker-chip-area-100-remove'));
        });
        expect(screen.queryByTestId('picker-chip-area-100')).toBeNull();
    });

    it('says so when nothing matches, rather than drawing an empty group', async () => {
        await renderStubScreen(<PickerHarness gazetteer={largeGazetteer()} />, {
            session: kitchenSession(),
        });
        await untilVisible('picker-search');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('picker-search-input'), 'Reykjavík');
        });
        expect(screen.getByTestId('picker-empty')).toBeTruthy();
    });
});

/* ------------------------------------------------------------------------------------------------
 * Branch operating hours
 * ---------------------------------------------------------------------------------------------- */

describe('the branch operating week', () => {
    it('renders all seven days for the branch already in context', async () => {
        await renderStubScreen(<BranchOperatingScreen />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: { getBranchOperating: async () => BRANCH_OPERATING } },
        });
        await untilVisible('kitchen-branch-hours-screen');

        for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
            expect(
                screen.getByTestId(`kitchen-branch-hours-rows-day-${String(weekday)}`),
            ).toBeTruthy();
        }
        // The branch and its time zone are stated: a cut-off is meaningless without the zone it is
        // read in.
        expect(screen.getByTestId('kitchen-branch-hours-timezone')).toHaveTextContent(
            new RegExp(BRANCH_OPERATING.timeZone.replace('/', '\\/')),
        );
    });

    it('removes the time fields when a day is closed, and restores them empty', async () => {
        await renderStubScreen(<BranchOperatingScreen />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: { getBranchOperating: async () => BRANCH_OPERATING } },
        });
        await untilVisible('kitchen-branch-hours-screen');

        const open = BRANCH_OPERATING.days.find((day) => day.opensAt !== null);
        if (open === undefined) throw new Error('The authored branch is closed all week.');
        const row = `kitchen-branch-hours-rows-day-${String(open.weekday)}`;

        expect(screen.getByTestId(`${row}-opens-input`)).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-closed-control`));
        });

        // Removed, not disabled: a disabled field still holding `08:00` would show a time that is
        // not being saved.
        expect(screen.queryByTestId(`${row}-opens-input`)).toBeNull();
        expect(screen.queryByTestId(`${row}-cut-off-input`)).toBeNull();
        expect(screen.getByTestId(`${row}-closed-note`)).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-closed-control`));
        });
        expect(screen.getByTestId(`${row}-opens-input`).props.value).toBe('');
    });

    it('marks the offending day when a rule is broken, and blocks the save', async () => {
        await renderStubScreen(<BranchOperatingScreen />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: { getBranchOperating: async () => BRANCH_OPERATING } },
        });
        await untilVisible('kitchen-branch-hours-screen');

        const open = BRANCH_OPERATING.days.find((day) => day.opensAt !== null);
        if (open === undefined) throw new Error('The authored branch is closed all week.');
        const row = `kitchen-branch-hours-rows-day-${String(open.weekday)}`;

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-opens-input`), '22:00');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-closes-input`), '08:00');
        });

        expect(screen.getByTestId(`${row}-error`)).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-branch-hours-screen-save').props.accessibilityState,
        ).toEqual(expect.objectContaining({ disabled: true }));

        // A cut-off after closing is the second rule, and it is reported on its own day.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-opens-input`), '08:00');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-closes-input`), '17:00');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-cut-off-input`), '19:00');
        });
        expect(screen.getByTestId(`${row}-error`)).toHaveTextContent(/cut-off/i);
    });

    it('copies one day onto every open day, announces it, and saves the week', async () => {
        let stored: BranchOperating = BRANCH_OPERATING;

        const { repositories } = await renderStubScreen(<BranchOperatingScreen />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: {
                    getBranchOperating: async () => stored,
                    setBranchOperating: async (_branchId, request) => {
                        stored = {
                            ...stored,
                            ...(request.timeZone === undefined
                                ? {}
                                : { timeZone: request.timeZone }),
                            days: request.days,
                            meta: { ...stored.meta, lockVersion: request.lockVersion + 1 },
                        };
                        return stored;
                    },
                },
            },
        });
        await untilVisible('kitchen-branch-hours-screen');

        const open = BRANCH_OPERATING.days.find((day) => day.opensAt !== null);
        const closed = BRANCH_OPERATING.days.find((day) => day.opensAt === null);
        if (open === undefined) throw new Error('The authored branch is closed all week.');
        const row = `kitchen-branch-hours-rows-day-${String(open.weekday)}`;

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-opens-input`), '09:15');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-closes-input`), '21:45');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-cut-off-input`), '17:30');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-copy`));
        });

        // A copy that changes four rows below the fold is invisible without an announcement.
        expect(screen.getByTestId('kitchen-branch-hours-rows-announcer')).toHaveTextContent(
            /copied/i,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-branch-hours-screen-save'));
        });

        await waitFor(() => {
            expect(repositories.kitchenAdmin.setBranchOperating).toHaveBeenCalledWith(
                BRANCH_ID,
                expect.objectContaining({ lockVersion: BRANCH_OPERATING.meta.lockVersion }),
            );
        });

        await waitFor(() => {
            expect(stored.days).toHaveLength(7);
            const openDays = stored.days.filter((day) => day.opensAt !== null);
            expect(openDays.length).toBeGreaterThan(1);
            for (const day of openDays) {
                expect(day.opensAt).toBe('09:15');
                expect(day.orderCutOffAt).toBe('17:30');
            }
        });

        // A day that was closed stays closed, carrying three nulls rather than disappearing.
        if (closed !== undefined) {
            expect(stored.days.find((day) => day.weekday === closed.weekday)).toEqual({
                weekday: closed.weekday,
                opensAt: null,
                closesAt: null,
                orderCutOffAt: null,
            });
        }
    });

    it('warns rather than silently accepting a branch that never trades', async () => {
        await renderStubScreen(<BranchOperatingScreen />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: { getBranchOperating: async () => BRANCH_OPERATING } },
        });
        await untilVisible('kitchen-branch-hours-screen');

        for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
            const control = screen.queryByTestId(
                `kitchen-branch-hours-rows-day-${String(weekday)}-closed-control`,
            );
            const alreadyClosed =
                screen.queryByTestId(
                    `kitchen-branch-hours-rows-day-${String(weekday)}-closed-note`,
                ) !== null;
            if (control !== null && !alreadyClosed) {
                // Sequential on purpose: each press is applied against the state the previous one
                // produced, and firing all seven at once would make the last write win.
                await act(async () => {
                    fireEvent.press(control);
                });
            }
        }

        await untilVisible('kitchen-branch-hours-all-closed');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The hub
 * ---------------------------------------------------------------------------------------------- */

describe('the delivery cards on the hub', () => {
    it('offers both families with counts read from the repository', async () => {
        const zones = [SEEDED_ZONE, UNDECIDED_ZONE];

        await renderStubScreen(<KitchenHomeScreen />, {
            session: kitchenSession(),
            repositories: hubRepositories(zones),
        });
        await untilVisible('kitchen-home-screen');

        expect(screen.getByTestId('kitchen-family-delivery-zones')).toBeTruthy();
        expect(screen.getByTestId('kitchen-family-branch-operating')).toBeTruthy();

        await untilVisible('kitchen-family-delivery-zones-total');
        expect(screen.getByTestId('kitchen-family-delivery-zones-total')).toHaveTextContent(
            new RegExp(String(zones.length)),
        );

        // The branch card counts trading days rather than records: a week has no publication state.
        await untilVisible('kitchen-family-branch-operating-total');
        const openDays = BRANCH_OPERATING.days.filter((day) => day.opensAt !== null).length;
        expect(screen.getByTestId('kitchen-family-branch-operating-total')).toHaveTextContent(
            new RegExp(String(openDays)),
        );
    });
});
