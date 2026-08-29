import type { AdminEntityMeta, PlanMenu, PlanMenuEntry } from '@healthy360/api-client/contracts';
import { MealId, SubscriptionPlanId } from '@healthy360/domain-types';

import {
    EMPTY_MENU,
    MENU_CYCLE_DAY_MAX,
    MENU_ENTRY_MAX,
    MENU_SEQUENCE_MAX,
    addMenuEntry,
    emptyMenuEntry,
    isFirstPublication,
    isMenuPublished,
    isMenuWithdrawal,
    menuDays,
    menuDocumentErrors,
    menuDraft,
    menuEntryErrors,
    menuRequest,
    nextCoordinate,
    patchMenuEntry,
    removeMenuEntry,
    restoreMenuEntry,
    withAnchorDate,
    withCycleDays,
} from './plan-menu.ts';
import type { MenuDraft, MenuEntryDraft } from './plan-menu.ts';

/**
 * The plan menu's model, asserted without rendering anything (Order Desk, phase 5).
 *
 * Five things this file exists to prove, and each of them is a rule the screen alone could not be
 * trusted with:
 *
 * 1. **A coordinate is the identity.** `(cycleDay, slot, sequence)` decides which dish is which, what
 *    counts as a duplicate, and what order a day is cooked in.
 * 2. **The menu is one document.** Any part present means all three must be; everything empty is the
 *    withdrawal, and the withdrawal is valid.
 * 3. **Shrinking the cycle never deletes anything.** The days that fall off the end keep their
 *    dishes, are marked, and block the save until somebody decides.
 * 4. **The round trip is lossless** in the fields the wire carries.
 * 5. **The cutover is detectable before it happens** — which is what lets the editor say so.
 */

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 * ---------------------------------------------------------------------------------------------- */

const PLAN_ID = SubscriptionPlanId.unsafe('01935f6d-0000-7000-8000-0000000b0001');

function mealIdentifier(ordinal: number): MealId {
    return MealId.unsafe(`01935f6d-0000-7000-8000-0000000e00${String(ordinal).padStart(2, '0')}`);
}

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 4,
        status: 'published',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

function wireEntry(ordinal: number, overrides: Partial<PlanMenuEntry> = {}): PlanMenuEntry {
    return {
        id: `entry-${String(ordinal)}`,
        cycleDay: 1,
        slot: 'lunch',
        sequence: 1,
        mealId: mealIdentifier(ordinal),
        mealName: { en: `Dish ${String(ordinal)}`, ar: `طبق ${String(ordinal)}` },
        ...overrides,
    };
}

/** A published fortnight: two dishes on day 1, one on day 14. */
function publishedMenu(overrides: Partial<PlanMenu> = {}): PlanMenu {
    return {
        planId: PLAN_ID,
        meta: meta(),
        cycleDays: 14,
        anchorDate: '2026-09-07',
        entries: [
            wireEntry(1, { cycleDay: 1, slot: 'breakfast', sequence: 1 }),
            wireEntry(2, { cycleDay: 1, slot: 'lunch', sequence: 1 }),
            wireEntry(3, { cycleDay: 14, slot: 'dinner', sequence: 2 }),
        ],
        ...overrides,
    };
}

/** A plan nobody has written a menu for — the state every plan starts in. */
function absentMenu(): PlanMenu {
    return { planId: PLAN_ID, meta: meta(), cycleDays: null, anchorDate: null, entries: [] };
}

const ROW_MESSAGES = {
    beyondCycle: 'beyond-cycle',
    mealRequired: 'meal-required',
    sequenceRequired: 'sequence-required',
    duplicateCoordinate: 'duplicate-coordinate',
};

const DOCUMENT_MESSAGES = {
    entriesRequired: 'entries-required',
    cycleRequired: 'cycle-required',
    anchorRequired: 'anchor-required',
    cycleOutOfRange: 'cycle-out-of-range',
    anchorMalformed: 'anchor-malformed',
    tooManyEntries: 'too-many-entries',
};

function row(overrides: Partial<MenuEntryDraft> = {}): MenuEntryDraft {
    return {
        key: 'row-1',
        cycleDay: 1,
        slot: 'lunch',
        sequence: 1,
        mealId: mealIdentifier(1),
        mealName: { en: 'Dish 1', ar: '' },
        ...overrides,
    };
}

function draftOf(
    entries: readonly MenuEntryDraft[],
    overrides: Partial<MenuDraft> = {},
): MenuDraft {
    return { cycleDays: 7, anchorDate: '2026-09-07', entries, ...overrides };
}

/* ------------------------------------------------------------------------------------------------
 * Coordinates
 * ---------------------------------------------------------------------------------------------- */

describe('the coordinate', () => {
    it('groups the rotation into days, and draws every day of it even when empty', () => {
        const days = menuDays(menuDraft(publishedMenu()));

        expect(days).toHaveLength(14);
        expect(days.map((day) => day.cycleDay)).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
        ]);
        expect(days[0]?.entries).toHaveLength(2);
        // A blank Wednesday is a fact about the menu, not a day that failed to draw.
        expect(days[1]?.entries).toHaveLength(0);
        expect(days[13]?.entries).toHaveLength(1);
        expect(days.every((day) => !day.isBeyondCycle)).toBe(true);
    });

    it('orders a day by sitting, then by position within it', () => {
        const draft = draftOf([
            row({ key: 'a', slot: 'snack', sequence: 1 }),
            row({ key: 'b', slot: 'lunch', sequence: 2 }),
            row({ key: 'c', slot: 'breakfast', sequence: 1 }),
            row({ key: 'd', slot: 'lunch', sequence: 1 }),
        ]);

        expect(menuDays(draft)[0]?.entries.map((entry) => entry.key)).toEqual(['c', 'd', 'b', 'a']);
    });

    it('hands out the first free coordinate on a day, slots before second sittings', () => {
        let draft = draftOf([]);

        expect(nextCoordinate(draft, 3)).toEqual({ slot: 'breakfast', sequence: 1 });

        draft = addMenuEntry(draft, emptyMenuEntry('k1', 3, { slot: 'breakfast', sequence: 1 }));
        expect(nextCoordinate(draft, 3)).toEqual({ slot: 'lunch', sequence: 1 });

        // A different day is untouched by what day 3 holds.
        expect(nextCoordinate(draft, 4)).toEqual({ slot: 'breakfast', sequence: 1 });
    });

    it('moves to a second sitting only once every slot of the day is taken', () => {
        const first = draftOf([
            row({ key: 'a', cycleDay: 2, slot: 'breakfast', sequence: 1 }),
            row({ key: 'b', cycleDay: 2, slot: 'lunch', sequence: 1 }),
            row({ key: 'c', cycleDay: 2, slot: 'dinner', sequence: 1 }),
            row({ key: 'd', cycleDay: 2, slot: 'snack', sequence: 1 }),
        ]);

        expect(nextCoordinate(first, 2)).toEqual({ slot: 'breakfast', sequence: 2 });
    });

    it('marks two dishes claiming one coordinate, and only the second of them', () => {
        const errors = menuEntryErrors(
            draftOf([
                row({ key: 'first', slot: 'lunch', sequence: 1 }),
                row({ key: 'second', slot: 'lunch', sequence: 1 }),
                row({ key: 'third', slot: 'lunch', sequence: 2 }),
            ]),
            ROW_MESSAGES,
        );

        expect(errors.get('first')).toBeUndefined();
        expect(errors.get('second')).toBe('duplicate-coordinate');
        expect(errors.get('third')).toBeUndefined();
    });

    it('does not let an unanswered position frame an innocent row as the duplicate', () => {
        const errors = menuEntryErrors(
            draftOf([
                row({ key: 'blank', sequence: null }),
                row({ key: 'real', slot: 'lunch', sequence: 1 }),
            ]),
            ROW_MESSAGES,
        );

        expect(errors.get('blank')).toBe('sequence-required');
        expect(errors.get('real')).toBeUndefined();
    });

    it('refuses a row with no dish and a position outside the server’s range', () => {
        const errors = menuEntryErrors(
            draftOf([
                row({ key: 'no-meal', mealId: null }),
                row({ key: 'too-high', slot: 'dinner', sequence: MENU_SEQUENCE_MAX + 1 }),
            ]),
            ROW_MESSAGES,
        );

        expect(errors.get('no-meal')).toBe('meal-required');
        expect(errors.get('too-high')).toBe('sequence-required');
    });
});

/* ------------------------------------------------------------------------------------------------
 * Shrinking the cycle
 * ---------------------------------------------------------------------------------------------- */

describe('shrinking the cycle', () => {
    it('keeps every dish that falls off the end, and marks the days it left behind', () => {
        const before = menuDraft(publishedMenu());
        const after = withCycleDays(before, 7);

        // Nothing was deleted. That is the whole rule.
        expect(after.entries).toHaveLength(before.entries.length);
        expect(after.entries).toEqual(before.entries);

        const days = menuDays(after);
        const fourteenth = days.find((day) => day.cycleDay === 14);
        expect(fourteenth?.isBeyondCycle).toBe(true);
        expect(fourteenth?.entries).toHaveLength(1);
        expect(days.find((day) => day.cycleDay === 1)?.isBeyondCycle).toBe(false);
    });

    it('blocks the save by marking the orphaned rows rather than by refusing silently', () => {
        const after = withCycleDays(menuDraft(publishedMenu()), 7);
        const errors = menuEntryErrors(after, ROW_MESSAGES);
        const orphan = after.entries.find((entry) => entry.cycleDay === 14);

        expect(orphan).toBeDefined();
        expect(errors.get(orphan?.key ?? '')).toBe('beyond-cycle');
        expect(errors.size).toBe(1);
    });

    it('clears the marks again when the cycle is lengthened back', () => {
        const shrunk = withCycleDays(menuDraft(publishedMenu()), 7);
        const restored = withCycleDays(shrunk, 14);

        expect(menuEntryErrors(restored, ROW_MESSAGES).size).toBe(0);
        expect(menuDays(restored).every((day) => !day.isBeyondCycle)).toBe(true);
    });
});

/* ------------------------------------------------------------------------------------------------
 * One document
 * ---------------------------------------------------------------------------------------------- */

describe('the one-document rule', () => {
    it('accepts a whole menu', () => {
        expect(menuDocumentErrors(menuDraft(publishedMenu()), DOCUMENT_MESSAGES)).toEqual([]);
    });

    it('accepts everything empty, because that is the withdrawal rather than an omission', () => {
        expect(menuDocumentErrors(EMPTY_MENU, DOCUMENT_MESSAGES)).toEqual([]);
        expect(isMenuWithdrawal(EMPTY_MENU)).toBe(true);
    });

    it('refuses dishes with no cycle', () => {
        const draft = withCycleDays(withAnchorDate(draftOf([row()]), null), null);

        expect(menuDocumentErrors(draft, DOCUMENT_MESSAGES)).toEqual([
            'cycle-required',
            'anchor-required',
        ]);
        expect(isMenuWithdrawal(draft)).toBe(false);
    });

    it('refuses a cycle with no dishes', () => {
        expect(menuDocumentErrors(draftOf([]), DOCUMENT_MESSAGES)).toEqual(['entries-required']);
    });

    it('refuses a cycle with no anchor, because nothing would say which day is day 1', () => {
        const draft = withAnchorDate(draftOf([row()]), null);

        expect(menuDocumentErrors(draft, DOCUMENT_MESSAGES)).toEqual(['anchor-required']);
    });

    it('refuses an anchor on its own', () => {
        const draft: MenuDraft = { cycleDays: null, anchorDate: '2026-09-07', entries: [] };

        expect(menuDocumentErrors(draft, DOCUMENT_MESSAGES)).toEqual([
            'entries-required',
            'cycle-required',
        ]);
    });

    it('re-checks the bounds the server states rather than assuming the steppers held', () => {
        expect(
            menuDocumentErrors(
                draftOf([row()], { cycleDays: MENU_CYCLE_DAY_MAX + 1 }),
                DOCUMENT_MESSAGES,
            ),
        ).toEqual(['cycle-out-of-range']);

        expect(
            menuDocumentErrors(draftOf([row()], { anchorDate: '7 September' }), DOCUMENT_MESSAGES),
        ).toEqual(['anchor-malformed']);

        const crowded = draftOf(
            Array.from({ length: MENU_ENTRY_MAX + 1 }, (_, index) =>
                row({ key: `k${String(index)}`, sequence: 1 }),
            ),
        );
        expect(menuDocumentErrors(crowded, DOCUMENT_MESSAGES)).toContain('too-many-entries');
    });
});

/* ------------------------------------------------------------------------------------------------
 * Editing
 * ---------------------------------------------------------------------------------------------- */

describe('editing a menu', () => {
    it('adds, patches and removes by key without touching its neighbours', () => {
        let draft = draftOf([row({ key: 'a' }), row({ key: 'b', slot: 'dinner' })]);

        draft = patchMenuEntry(draft, 'b', { mealId: mealIdentifier(9), sequence: 2 });
        expect(draft.entries[1]?.mealId).toBe(mealIdentifier(9));
        expect(draft.entries[1]?.sequence).toBe(2);
        expect(draft.entries[0]).toEqual(row({ key: 'a' }));

        draft = removeMenuEntry(draft, 'a');
        expect(draft.entries.map((entry) => entry.key)).toEqual(['b']);
    });

    it('restores a removed row to its own position, which is what makes it an undo', () => {
        const first = row({ key: 'a' });
        const second = row({ key: 'b', slot: 'dinner' });
        const third = row({ key: 'c', slot: 'snack' });
        const draft = draftOf([first, second, third]);

        const removed = removeMenuEntry(draft, 'b');
        expect(restoreMenuEntry(removed, second, 1).entries.map((entry) => entry.key)).toEqual([
            'a',
            'b',
            'c',
        ]);
        // A nonsense index puts it somewhere real rather than splicing from the far end.
        expect(restoreMenuEntry(removed, second, -1).entries[0]?.key).toBe('b');
    });

    it('leaves a new row without a dish rather than choosing one', () => {
        const added = emptyMenuEntry('fresh', 5, { slot: 'dinner', sequence: 1 });

        expect(added.mealId).toBeNull();
        expect(added.cycleDay).toBe(5);
        expect(menuEntryErrors(draftOf([added]), ROW_MESSAGES).get('fresh')).toBe('meal-required');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The round trip
 * ---------------------------------------------------------------------------------------------- */

describe('the wire round trip', () => {
    it('reads a menu in and writes the same one back out', () => {
        const menu = publishedMenu();
        const body = menuRequest(menuDraft(menu));

        expect(body.cycleDays).toBe(menu.cycleDays);
        expect(body.anchorDate).toBe(menu.anchorDate);
        expect(body.entries).toEqual(
            menu.entries.map((entry) => ({
                cycleDay: entry.cycleDay,
                slot: entry.slot,
                sequence: entry.sequence,
                mealId: entry.mealId,
            })),
        );
    });

    it('preserves the order the server sent, rather than sorting it into a new one', () => {
        const menu = publishedMenu({
            entries: [
                wireEntry(3, { cycleDay: 14, slot: 'dinner', sequence: 2 }),
                wireEntry(1, { cycleDay: 1, slot: 'breakfast', sequence: 1 }),
            ],
        });

        expect(menuRequest(menuDraft(menu)).entries.map((entry) => entry.cycleDay)).toEqual([
            14, 1,
        ]);
    });

    it('drops an unfinished row rather than fabricating a dish or a position for it', () => {
        const body = menuRequest(
            draftOf([
                row({ key: 'good' }),
                row({ key: 'no-meal', slot: 'dinner', mealId: null }),
                row({ key: 'no-sequence', slot: 'snack', sequence: null }),
            ]),
        );

        expect(body.entries).toHaveLength(1);
        expect(body.entries[0]?.slot).toBe('lunch');
    });

    it('sends all three parts as empty for a withdrawal, rather than omitting them', () => {
        const body = menuRequest(EMPTY_MENU);

        expect(body).toEqual({ entries: [], cycleDays: null, anchorDate: null });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The cutover
 * ---------------------------------------------------------------------------------------------- */

describe('the stock cutover', () => {
    it('knows whether the server holds a menu at all', () => {
        expect(isMenuPublished(publishedMenu())).toBe(true);
        expect(isMenuPublished(absentMenu())).toBe(false);
        // A cycle with no dishes yet is still a menu the plan holds — half-written, but there.
        expect(isMenuPublished({ ...absentMenu(), cycleDays: 7 })).toBe(true);
    });

    it('is the first publication only when the plan had none and the draft has one', () => {
        const draft = menuDraft(publishedMenu());

        expect(isFirstPublication(absentMenu(), draft)).toBe(true);
        // Editing a menu that already exists is not a cutover; it already happened.
        expect(isFirstPublication(publishedMenu(), draft)).toBe(false);
        // Neither is withdrawing one.
        expect(isFirstPublication(publishedMenu(), EMPTY_MENU)).toBe(false);
        // Nor is leaving a plan without a menu alone.
        expect(isFirstPublication(absentMenu(), EMPTY_MENU)).toBe(false);
    });
});
