import { PLAN_MENU_SLOTS } from '@healthy360/api-client/contracts';
import type {
    LocalisedText,
    PlanMenu,
    PlanMenuEntry,
    PlanMenuEntryInput,
    PlanMenuSlot,
} from '@healthy360/api-client/contracts';
import type { MealId } from '@healthy360/domain-types';

/**
 * The model behind the plan editor's fifth section — a plan's fixed menu.
 *
 * Pure, and in its own module for `./plan-matrix.ts`'s reason: the interesting decisions here — what
 * a row *is*, what shrinking a cycle does to the days that fall off the end, when a menu counts as
 * published at all — are the ones a test should be able to make assertions about without rendering a
 * tree.
 *
 * ## What a menu is, in this contract
 *
 * A **rotation**, not a calendar. Three things together say what a plan serves:
 *
 * * `cycleDays` — how long the rotation runs before it starts again;
 * * `anchorDate` — the calendar date cycle **day 1** falls on;
 * * `entries` — one dish per `(cycleDay, slot, sequence)` coordinate.
 *
 * The cycle is anchored to the *plan*, not to each subscriber: everybody on a 7-day menu eats
 * Tuesday's lunch on Tuesday, which is what makes a day one production run rather than an à la carte
 * service, and what makes an ingredient forecast possible at all.
 *
 * The coordinate is the identity. `sequence` exists for the kitchen that serves lunch twice, and is
 * `1` unless somebody says otherwise; an entry carries no identifier of its own on the way up,
 * because the whole document is replaced and a coordinate is what a dish is addressed by.
 *
 * ## One document, and that is a rule rather than a convention
 *
 * Entries with no cycle length, a cycle length with no entries, and a cycle length with no anchor are
 * each refused by the server (`422`). All three empty is **not** a refusal — it is the legitimate
 * statement "this plan has no menu", which is what withdraws one. {@link menuDocumentErrors} states
 * that as one rule in one direction: if any part is present, all three must be.
 *
 * ## Shrinking the cycle never deletes a day
 *
 * Taking a 14-day rotation down to 7 leaves the dishes on days 8–14 exactly where they are and marks
 * them, rather than quietly discarding a week of somebody's work in a numeric stepper. The rows say
 * they are beyond the cycle, the save is blocked until they are dealt with, and dealing with them is
 * either lengthening the cycle again or removing the rows deliberately. See
 * {@link menuEntryErrors}'s first rule and {@link menuDays}'s `isBeyondCycle`.
 *
 * ## Publishing one is a cutover
 *
 * Until a plan has a menu, its generated subscription orders carry no meal lines and deduct **no**
 * stock. From the first save they do. {@link isFirstPublication} is how the editor knows to say so
 * before the button is pressed rather than after the stock moved.
 */

/* ------------------------------------------------------------------------------------------------
 * Bounds the server states
 * ---------------------------------------------------------------------------------------------- */

/** Longest rotation the write accepts, and the highest day an entry may sit on. */
export const MENU_CYCLE_DAY_MAX = 366;

/** Highest `sequence`: the kitchen that serves lunch twice, with room to spare. */
export const MENU_SEQUENCE_MAX = 12;

/** Most entries one document may carry — a year of four-slot days, with headroom. */
export const MENU_ENTRY_MAX = 400;

/* ------------------------------------------------------------------------------------------------
 * Working copy
 * ---------------------------------------------------------------------------------------------- */

/**
 * One dish as the editor holds it.
 *
 * `cycleDay` is **not** nullable, because a row is created inside a day and never floats: the day is
 * the group it is rendered in, not a field on it. `slot` is not nullable either — the control that
 * sets it is a four-value select with no empty state, and a dish served at no sitting is not a menu
 * entry. `sequence` and `mealId` *are*, because `NumberStepper` hands back `number | null` for "not
 * answered" and a freshly added row has no dish in it yet.
 */
export interface MenuEntryDraft {
    /** Stable across removal and undo. Never the array index. */
    readonly key: string;
    readonly cycleDay: number;
    readonly slot: PlanMenuSlot;
    readonly sequence: number | null;
    readonly mealId: MealId | null;
    /** Carried for display only. Never sent — the server resolves the name from the identifier. */
    readonly mealName: LocalisedText;
}

/** The whole menu as the editor holds it: one document, three parts. */
export interface MenuDraft {
    readonly cycleDays: number | null;
    /** `YYYY-MM-DD`, or `null`. */
    readonly anchorDate: string | null;
    readonly entries: readonly MenuEntryDraft[];
}

/** No menu at all — the state every plan is in until somebody writes one. */
export const EMPTY_MENU: MenuDraft = { cycleDays: null, anchorDate: null, entries: [] };

export function menuEntryDraft(entry: PlanMenuEntry, index: number): MenuEntryDraft {
    return {
        key: `seed-menu-${String(index)}-${entry.id}`,
        cycleDay: entry.cycleDay,
        slot: entry.slot,
        sequence: entry.sequence,
        mealId: entry.mealId,
        mealName: entry.mealName,
    };
}

/** The server's menu as a working copy. The `fromWire` half of the round trip. */
export function menuDraft(menu: PlanMenu): MenuDraft {
    return {
        cycleDays: menu.cycleDays,
        anchorDate: menu.anchorDate,
        entries: menu.entries.map(menuEntryDraft),
    };
}

/**
 * A blank row on one day.
 *
 * No dish, because inventing one would put a meal on a menu nobody chose. The coordinate is filled
 * in by {@link nextCoordinate}, so a new row never lands on top of an existing one.
 */
export function emptyMenuEntry(
    key: string,
    cycleDay: number,
    coordinate: { readonly slot: PlanMenuSlot; readonly sequence: number },
): MenuEntryDraft {
    return {
        key,
        cycleDay,
        slot: coordinate.slot,
        sequence: coordinate.sequence,
        mealId: null,
        mealName: { en: '', ar: '' },
    };
}

/**
 * The first free coordinate on a day.
 *
 * Slots first, then sequences: breakfast, lunch, dinner, snack, then a second breakfast, and so on.
 * Deterministic, so adding two rows in a row puts them in two different places rather than stacking
 * a duplicate the validator then complains about.
 *
 * A day with every one of the 48 coordinates taken falls back to the last of them, which is a
 * duplicate and is *marked* as one — a fabricated 13th sequence would be refused by the server
 * instead, and a refusal is worse than a message.
 */
export function nextCoordinate(
    draft: MenuDraft,
    cycleDay: number,
): { readonly slot: PlanMenuSlot; readonly sequence: number } {
    const taken = new Set(
        draft.entries
            .filter((entry) => entry.cycleDay === cycleDay && entry.sequence !== null)
            .map((entry) => `${entry.slot}:${String(entry.sequence)}`),
    );

    for (let sequence = 1; sequence <= MENU_SEQUENCE_MAX; sequence += 1) {
        for (const slot of PLAN_MENU_SLOTS) {
            if (!taken.has(`${slot}:${String(sequence)}`)) return { slot, sequence };
        }
    }

    return { slot: 'snack', sequence: MENU_SEQUENCE_MAX };
}

/* ------------------------------------------------------------------------------------------------
 * Operations
 * ---------------------------------------------------------------------------------------------- */

/**
 * Sets the length of the rotation.
 *
 * **Entries are untouched, deliberately.** Shrinking a cycle below an occupied day does not delete
 * that day: it makes those rows invalid, and they say so. A stepper that discarded rows as a
 * side-effect of a number going down would be the single most destructive control in this workspace,
 * and it would do it without a confirmation, an undo or a trace.
 */
export function withCycleDays(draft: MenuDraft, cycleDays: number | null): MenuDraft {
    return { ...draft, cycleDays };
}

/** Sets the date cycle day 1 falls on. */
export function withAnchorDate(draft: MenuDraft, anchorDate: string | null): MenuDraft {
    return { ...draft, anchorDate };
}

export function addMenuEntry(draft: MenuDraft, entry: MenuEntryDraft): MenuDraft {
    return { ...draft, entries: [...draft.entries, entry] };
}

export function removeMenuEntry(draft: MenuDraft, key: string): MenuDraft {
    return { ...draft, entries: draft.entries.filter((entry) => entry.key !== key) };
}

/**
 * Restores a removed row **at its old index**, which is the difference between undo and re-add.
 *
 * The index is clamped at both ends rather than trusted: a negative one would splice from the far
 * end, putting the row back somewhere nobody removed it from.
 */
export function restoreMenuEntry(
    draft: MenuDraft,
    entry: MenuEntryDraft,
    index: number,
): MenuDraft {
    const entries = [...draft.entries];
    entries.splice(Math.max(0, Math.min(index, entries.length)), 0, entry);
    return { ...draft, entries };
}

export function patchMenuEntry(
    draft: MenuDraft,
    key: string,
    patch: Partial<Omit<MenuEntryDraft, 'key'>>,
): MenuDraft {
    return {
        ...draft,
        entries: draft.entries.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    };
}

/* ------------------------------------------------------------------------------------------------
 * The days
 * ---------------------------------------------------------------------------------------------- */

/** One day of the rotation, with the dishes on it. */
export interface MenuDay {
    readonly cycleDay: number;
    /**
     * True for a day the current cycle length does not reach.
     *
     * Only ever the result of shrinking the cycle under occupied days. The day is still drawn —
     * hiding it would hide the rows that are blocking the save.
     */
    readonly isBeyondCycle: boolean;
    /** Ordered by sitting, then by sequence. The order a day is cooked in. */
    readonly entries: readonly MenuEntryDraft[];
}

const SLOT_ORDER: ReadonlyMap<PlanMenuSlot, number> = new Map(
    PLAN_MENU_SLOTS.map((slot, index): readonly [PlanMenuSlot, number] => [slot, index]),
);

/**
 * The rotation as days, which is how a person reads a menu and how a kitchen cooks one.
 *
 * Every day from 1 to the cycle length is present **even when it is empty**, because a blank
 * Wednesday is a fact about the menu — a plan that serves nothing on Wednesday — and a day that
 * simply did not appear would look like a screen that failed to draw it. Days beyond the cycle
 * appear too when something occupies them; see {@link MenuDay.isBeyondCycle}.
 *
 * With no cycle length set, the days are exactly the occupied ones: there is no rotation to
 * enumerate, and that state is already invalid for the document reason.
 */
export function menuDays(draft: MenuDraft): readonly MenuDay[] {
    const occupied = new Map<number, MenuEntryDraft[]>();
    for (const entry of draft.entries) {
        const day = occupied.get(entry.cycleDay);
        if (day === undefined) occupied.set(entry.cycleDay, [entry]);
        else day.push(entry);
    }

    const numbers = new Set<number>(occupied.keys());
    if (draft.cycleDays !== null) {
        for (let day = 1; day <= draft.cycleDays; day += 1) numbers.add(day);
    }

    return [...numbers]
        .sort((left, right) => left - right)
        .map((cycleDay) => ({
            cycleDay,
            isBeyondCycle: draft.cycleDays !== null && cycleDay > draft.cycleDays,
            entries: [...(occupied.get(cycleDay) ?? [])].sort((left, right) => {
                const slots = (SLOT_ORDER.get(left.slot) ?? 0) - (SLOT_ORDER.get(right.slot) ?? 0);
                if (slots !== 0) return slots;
                return (left.sequence ?? 0) - (right.sequence ?? 0);
            }),
        }));
}

/* ------------------------------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------------------------------- */

export interface MenuEntryMessages {
    readonly beyondCycle: string;
    readonly mealRequired: string;
    readonly sequenceRequired: string;
    readonly duplicateCoordinate: string;
}

/**
 * What is wrong with each row, keyed by row.
 *
 * Four rules, first one wins, in the order a person can act on them:
 *
 * 1. **The day has to exist in the cycle.** This is the shrink refusal, and it is first because it is
 *    the only one whose remedy might be to change something other than the row — lengthening the
 *    cycle again fixes every row at once.
 * 2. **A row needs a dish.** A coordinate with nothing in it is a slot the kitchen has not filled,
 *    and sending it would be refused (`A menu entry has to say which dish fills the slot.`).
 * 3. **A sequence is a positive whole number**, at most {@link MENU_SEQUENCE_MAX}. `null` is
 *    "not answered", which is not a coordinate.
 * 4. **A coordinate is unique.** `(cycleDay, slot, sequence)` is the primary key of the table
 *    underneath; two rows sharing one is not untidy, it is two dishes claiming the same plate, and
 *    the replacement would keep whichever the server wrote last.
 *
 * A row already flagged for an unanswered sequence never reaches the duplicate check and never joins
 * the seen set, so it cannot make an innocent third row look like the duplicate.
 */
export function menuEntryErrors(
    draft: MenuDraft,
    messages: MenuEntryMessages,
): ReadonlyMap<string, string> {
    const errors = new Map<string, string>();
    const seen = new Set<string>();

    for (const entry of draft.entries) {
        if (draft.cycleDays !== null && entry.cycleDay > draft.cycleDays) {
            errors.set(entry.key, messages.beyondCycle);
            continue;
        }
        if (entry.mealId === null) {
            errors.set(entry.key, messages.mealRequired);
            continue;
        }
        if (
            entry.sequence === null ||
            !Number.isInteger(entry.sequence) ||
            entry.sequence < 1 ||
            entry.sequence > MENU_SEQUENCE_MAX
        ) {
            errors.set(entry.key, messages.sequenceRequired);
            continue;
        }

        const coordinate = `${String(entry.cycleDay)}:${entry.slot}:${String(entry.sequence)}`;
        if (seen.has(coordinate)) {
            errors.set(entry.key, messages.duplicateCoordinate);
            continue;
        }
        seen.add(coordinate);
    }

    return errors;
}

export interface MenuDocumentMessages {
    readonly entriesRequired: string;
    readonly cycleRequired: string;
    readonly anchorRequired: string;
    readonly cycleOutOfRange: string;
    readonly anchorMalformed: string;
    readonly tooManyEntries: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What is wrong with the menu as a whole, as sentences rather than per-row messages.
 *
 * The one-document rule, stated once and in one direction: **if any part of the menu is present,
 * all three must be.** Everything empty is not an incomplete menu, it is no menu — the withdrawal,
 * which is a decision a kitchen is entitled to make and the state every plan starts in.
 *
 * The three bounds after it are the server's own (`gt:0`, `max:366`, `max:400`, `Y-m-d`), re-checked
 * here rather than assumed: the steppers make them unreachable through the controls, but a draft can
 * also arrive from a server that has been asked for something this editor never sent.
 */
export function menuDocumentErrors(
    draft: MenuDraft,
    messages: MenuDocumentMessages,
): readonly string[] {
    const hasEntries = draft.entries.length > 0;
    const hasCycle = draft.cycleDays !== null;
    const hasAnchor = draft.anchorDate !== null;

    if (!hasEntries && !hasCycle && !hasAnchor) return [];

    const reasons: string[] = [];
    if (!hasEntries) reasons.push(messages.entriesRequired);
    if (!hasCycle) reasons.push(messages.cycleRequired);
    if (!hasAnchor) reasons.push(messages.anchorRequired);

    if (
        draft.cycleDays !== null &&
        (!Number.isInteger(draft.cycleDays) ||
            draft.cycleDays < 1 ||
            draft.cycleDays > MENU_CYCLE_DAY_MAX)
    ) {
        reasons.push(messages.cycleOutOfRange);
    }
    if (draft.anchorDate !== null && !ISO_DATE.test(draft.anchorDate)) {
        reasons.push(messages.anchorMalformed);
    }
    if (draft.entries.length > MENU_ENTRY_MAX) reasons.push(messages.tooManyEntries);

    return reasons;
}

/** True when saving this draft would withdraw the menu: all three parts empty, on purpose. */
export function isMenuWithdrawal(draft: MenuDraft): boolean {
    return draft.entries.length === 0 && draft.cycleDays === null && draft.anchorDate === null;
}

/** True when the server currently holds a menu for this plan. */
export function isMenuPublished(menu: PlanMenu): boolean {
    return menu.cycleDays !== null || menu.entries.length > 0;
}

/**
 * True when saving would publish this plan's **first** menu.
 *
 * The moment worth naming: the plan's generated orders carry no meal lines and deduct no stock
 * today, and from this save they do. Per-plan, and the publication *is* the opt-in — which is why
 * the editor says it here rather than leaving it to a release note nobody reads.
 */
export function isFirstPublication(menu: PlanMenu, draft: MenuDraft): boolean {
    return !isMenuPublished(menu) && !isMenuWithdrawal(draft);
}

/* ------------------------------------------------------------------------------------------------
 * Request
 * ---------------------------------------------------------------------------------------------- */

/** The three fields `replacePlanMenu` takes, beside the lock version the caller reads at press time. */
export interface MenuRequestBody {
    readonly entries: readonly PlanMenuEntryInput[];
    readonly cycleDays: number | null;
    readonly anchorDate: string | null;
}

/**
 * The draft as the write takes it — the `toWire` half of the round trip.
 *
 * Called only once {@link menuEntryErrors} and {@link menuDocumentErrors} are both empty, so the
 * narrowing cannot fail; a row that somehow arrives here without a dish or a sequence is **dropped**
 * rather than sent with a fabricated `1`, which is the same rule the variant request applies to a
 * missing number. Order is preserved: the server stores what it is sent, and a reordering here would
 * make a saved menu read back in an order nobody chose.
 */
export function menuRequest(draft: MenuDraft): MenuRequestBody {
    return {
        entries: draft.entries.flatMap((entry) => {
            if (entry.mealId === null || entry.sequence === null) return [];
            return [
                {
                    cycleDay: entry.cycleDay,
                    slot: entry.slot,
                    sequence: entry.sequence,
                    mealId: entry.mealId,
                },
            ];
        }),
        cycleDays: draft.cycleDays,
        anchorDate: draft.anchorDate,
    };
}
