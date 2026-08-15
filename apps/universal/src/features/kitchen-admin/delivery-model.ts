import type {
    BranchOperating,
    BranchOperatingDay,
    DeliveryWindow,
    DeliveryWindowInput,
    DeliveryZoneAdmin,
    LocalisedText,
    ServiceArea,
} from '@healthy360/api-client/contracts';
import type { CurrencyCode, DeliveryWindowId, ServiceAreaId } from '@healthy360/domain-types';

import { ISO_WEEKDAYS, parseClockTime, parseMinorAmount } from './format.ts';

/**
 * The delivery slice's model, with no React in it (K1.7).
 *
 * Three editors sit on top of this — the zone's areas, the zone's delivery windows and a branch's
 * trading week — and every rule that decides whether they may be saved lives here, as a pure
 * function over plain data. The plan matrix (`./plan-matrix.ts`) made the case for the shape; this
 * slice needs it more, because two of its three rules are *time* rules and a time rule asserted
 * through a rendered form is a rule asserted once, slowly, in one language.
 *
 * ## Three things this module is deliberately strict about
 *
 * 1. **A closed day is a row with three nulls, never an absent row.** The contract says so in prose
 *    ({@link BranchOperatingDay}) and the mock store refuses a week that is not exactly seven rows.
 *    So {@link operatingDraftsFrom} always produces seven, in weekday order, filling anything the
 *    server did not send as closed rather than dropping it — and {@link withDayClosed} *clears* the
 *    three fields when a day is closed rather than leaving them in place behind a disabled control,
 *    which is the same remove-not-disable rule the price editor's amount follows.
 * 2. **`null` and `0` are different answers, and a form must not blur them.** A delivery fee of
 *    `null` is "nothing recorded"; a delivery fee of `0` is "free, and we decided that". They reach
 *    the same column, so only the editor can keep them apart — {@link moneyInputState} is what the
 *    caption under each amount field reads, and it is asserted directly.
 * 3. **A time is `HH:mm` wall-clock in the branch's own zone.** Never an instant, never localised
 *    digits: `parseClockTime` in `./format.ts` accepts Latin `H:mm`/`HH:mm` and nothing else, for
 *    the reason every numeric draft in this workspace gives — the value is on its way to a column,
 *    and a field that accepted `١٨:٠٠` would make round-tripping a cut-off depend on the interface
 *    language.
 */

/* ------------------------------------------------------------------------------------------------
 * Weekdays
 * ---------------------------------------------------------------------------------------------- */

/**
 * Sorts a weekday list into ISO order and drops anything outside 1–7 or repeated.
 *
 * A `DeliveryWindow.weekdays` is a set expressed as an array, and two rules follow from that: the
 * order it arrives in carries no meaning, and a duplicate is not a second Tuesday. Normalising on
 * the way *out* of the editor rather than on the way in means a person toggling chips never sees
 * their list rearrange under them.
 */
export function normaliseWeekdays(weekdays: readonly number[]): readonly number[] {
    return [...new Set(weekdays)]
        .filter((weekday) => Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)
        .sort((left, right) => left - right);
}

/* ------------------------------------------------------------------------------------------------
 * Money that may be absent
 * ---------------------------------------------------------------------------------------------- */

/**
 * What a money field's current text *means*.
 *
 * `unset` and `zero` are the pair this exists for. Both render as an empty-looking record on a
 * consumer surface and they are not the same fact, so the editor states which one it is holding
 * rather than leaving the reader to infer it from an empty box.
 */
export const MONEY_INPUT_STATES = ['unset', 'zero', 'amount', 'invalid'] as const;
export type MoneyInputState = (typeof MONEY_INPUT_STATES)[number];

export function moneyInputState(value: string, currency: CurrencyCode): MoneyInputState {
    if (value.trim() === '') return 'unset';
    const parsed = parseMinorAmount(value, currency);
    if (parsed === null) return 'invalid';
    return parsed === 0 ? 'zero' : 'amount';
}

/**
 * The minor-unit value a money field carries, or `null` for "nothing recorded".
 *
 * Returns `null` for an unparseable value as well, which is safe only because a caller must refuse
 * to save while {@link moneyInputState} reports `invalid` — sending `null` for a typo would silently
 * erase a fee somebody meant to change.
 */
export function moneyInputValue(value: string, currency: CurrencyCode): number | null {
    const state = moneyInputState(value, currency);
    if (state === 'unset' || state === 'invalid') return null;
    return parseMinorAmount(value, currency);
}

/* ------------------------------------------------------------------------------------------------
 * Delivery windows
 * ---------------------------------------------------------------------------------------------- */

/**
 * One delivery window as the editor holds it.
 *
 * `startsAt`, `endsAt` and `capacity` are strings for the reason every numeric draft in this
 * workspace is: `08:` is a time half-typed, not a time, and a draft that parsed on every keystroke
 * would fight the person typing.
 */
export interface DeliveryWindowDraft {
    /** Stable across removals and undo. Never the array index. */
    readonly key: string;
    /** `null` for a window being added — the server mints the identifier. */
    readonly id: DeliveryWindowId | null;
    readonly label: LocalisedText;
    readonly weekdays: readonly number[];
    readonly startsAt: string;
    readonly endsAt: string;
    readonly capacity: string;
    readonly isActive: boolean;
}

export function windowDraft(window: DeliveryWindow, index: number): DeliveryWindowDraft {
    return {
        key: `seed-window-${String(index)}-${String(window.id)}`,
        id: window.id,
        label: window.label,
        weekdays: normaliseWeekdays(window.weekdays),
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        capacity: window.capacity === null ? '' : String(window.capacity),
        isActive: window.isActive,
    };
}

/** A blank window. Monday to Friday, because a working week is the shape almost every one has. */
export function emptyWindow(key: string): DeliveryWindowDraft {
    return {
        key,
        id: null,
        label: { en: '', ar: '' },
        weekdays: [1, 2, 3, 4, 5],
        startsAt: '',
        endsAt: '',
        capacity: '',
        isActive: true,
    };
}

export interface DeliveryWindowMessages {
    readonly labelRequired: string;
    readonly weekdaysRequired: string;
    readonly startInvalid: string;
    readonly endInvalid: string;
    readonly endBeforeStart: string;
    readonly capacityInvalid: string;
}

/**
 * What is wrong with each window, keyed by row.
 *
 * `endsAt` must be strictly after `startsAt`, compared as the zero-padded strings
 * {@link parseClockTime} produces — which sorts correctly for a 24-hour clock and needs no date. A
 * window that crosses midnight therefore cannot be expressed, and that is the contract's limit
 * rather than this editor's: `DeliveryWindow` carries two wall-clock times and no day offset, so
 * accepting `22:00–02:00` here would store a rule the server reads backwards.
 */
export function windowErrors(
    rows: readonly DeliveryWindowDraft[],
    messages: DeliveryWindowMessages,
): ReadonlyMap<string, string> {
    const errors = new Map<string, string>();

    for (const row of rows) {
        if (row.label.en.trim() === '') {
            errors.set(row.key, messages.labelRequired);
            continue;
        }
        if (normaliseWeekdays(row.weekdays).length === 0) {
            errors.set(row.key, messages.weekdaysRequired);
            continue;
        }

        const startsAt = parseClockTime(row.startsAt);
        if (startsAt === null) {
            errors.set(row.key, messages.startInvalid);
            continue;
        }
        const endsAt = parseClockTime(row.endsAt);
        if (endsAt === null) {
            errors.set(row.key, messages.endInvalid);
            continue;
        }
        if (endsAt <= startsAt) {
            errors.set(row.key, messages.endBeforeStart);
            continue;
        }

        if (row.capacity.trim() !== '') {
            const capacity = Number(row.capacity.trim());
            if (!/^\d+$/.test(row.capacity.trim()) || !Number.isSafeInteger(capacity)) {
                errors.set(row.key, messages.capacityInvalid);
                continue;
            }
            if (capacity === 0) errors.set(row.key, messages.capacityInvalid);
        }
    }

    return errors;
}

/**
 * The windows as `setDeliveryWindows` takes them.
 *
 * Only ever called once {@link windowErrors} is empty, so the parses here cannot fail; the fallbacks
 * exist because a total function is easier to reason about than one that throws from inside a save.
 */
export function windowRequest(
    rows: readonly DeliveryWindowDraft[],
): readonly DeliveryWindowInput[] {
    return rows.map((row) => ({
        id: row.id,
        label: row.label,
        weekdays: normaliseWeekdays(row.weekdays),
        startsAt: parseClockTime(row.startsAt) ?? row.startsAt,
        endsAt: parseClockTime(row.endsAt) ?? row.endsAt,
        capacity: row.capacity.trim() === '' ? null : Number(row.capacity.trim()),
        isActive: row.isActive,
    }));
}

export interface WindowCoverage {
    readonly total: number;
    readonly active: number;
    /** Weekdays at least one *active* window reaches, in ISO order. */
    readonly weekdays: readonly number[];
}

/**
 * What a zone's delivery week looks like, for the list column and the section heading.
 *
 * Typed on the two fields it reads rather than on {@link DeliveryWindow}, so the list can summarise
 * what the server holds and the editor can summarise what is on screen — from one definition. Two
 * copies of "which days does this zone reach?" would eventually disagree, and the one on screen is
 * the one a person is about to save.
 */
export function summariseWindows(
    windows: readonly {
        readonly weekdays: readonly number[];
        readonly isActive: boolean;
    }[],
): WindowCoverage {
    const weekdays = new Set<number>();
    let active = 0;
    for (const window of windows) {
        if (!window.isActive) continue;
        active += 1;
        for (const weekday of normaliseWeekdays(window.weekdays)) weekdays.add(weekday);
    }
    return {
        total: windows.length,
        active,
        weekdays: [...weekdays].sort((left, right) => left - right),
    };
}

/* ------------------------------------------------------------------------------------------------
 * Branch operating days
 * ---------------------------------------------------------------------------------------------- */

/**
 * One weekday of a branch's trading pattern as the editor holds it.
 *
 * `isClosed` is derived on the way in and authoritative on the way out: the contract encodes closed
 * as three nulls, and a form whose "closed" state were merely "the fields happen to be empty" could
 * not tell a closed Friday from a Friday nobody has filled in — which is the exact ambiguity the
 * contract's seven-rows rule exists to remove.
 */
export interface OperatingDayDraft {
    readonly weekday: number;
    readonly isClosed: boolean;
    readonly opensAt: string;
    readonly closesAt: string;
    readonly orderCutOffAt: string;
}

/** True when the server's row says "closed": all three times absent. */
export function isClosedDay(day: BranchOperatingDay): boolean {
    return day.opensAt === null && day.closesAt === null && day.orderCutOffAt === null;
}

/**
 * Seven rows in weekday order, whatever the server sent.
 *
 * A weekday the response omits is rendered as **closed**, not skipped: this editor's whole job is to
 * make every one of the seven answerable, and a six-row week would hide the one that is missing.
 */
export function operatingDraftsFrom(operating: BranchOperating): readonly OperatingDayDraft[] {
    const byWeekday = new Map(operating.days.map((day) => [day.weekday, day]));

    return ISO_WEEKDAYS.map((weekday) => {
        const day = byWeekday.get(weekday);
        if (day === undefined || isClosedDay(day)) {
            return { weekday, isClosed: true, opensAt: '', closesAt: '', orderCutOffAt: '' };
        }
        return {
            weekday,
            isClosed: false,
            opensAt: day.opensAt ?? '',
            closesAt: day.closesAt ?? '',
            orderCutOffAt: day.orderCutOffAt ?? '',
        };
    });
}

/**
 * Opens or closes one day.
 *
 * Closing **clears** the three times rather than hiding them behind a disabled control: the request
 * this row becomes carries three nulls, and leaving a stale `08:00` in the draft would mean the
 * value on screen and the value being sent had quietly diverged. Re-opening therefore starts empty,
 * which is honest — nobody has said when this day trades — and is what the copy-to-every-open-day
 * control exists to make cheap.
 */
export function withDayClosed(row: OperatingDayDraft, isClosed: boolean): OperatingDayDraft {
    if (isClosed) {
        return { ...row, isClosed: true, opensAt: '', closesAt: '', orderCutOffAt: '' };
    }
    return { ...row, isClosed: false };
}

/**
 * Copies one day's times onto every other **open** day.
 *
 * Closed days stay closed. The alternative — opening the whole week because one day was copied —
 * would silently invent trading hours for a day somebody had deliberately shut, which is precisely
 * the kind of inference an order cut-off must never be subject to.
 */
export function copyDayToOpenDays(
    rows: readonly OperatingDayDraft[],
    weekday: number,
): readonly OperatingDayDraft[] {
    const source = rows.find((row) => row.weekday === weekday);
    if (source === undefined || source.isClosed) return rows;

    return rows.map((row) =>
        row.weekday === weekday || row.isClosed
            ? row
            : {
                  ...row,
                  opensAt: source.opensAt,
                  closesAt: source.closesAt,
                  orderCutOffAt: source.orderCutOffAt,
              },
    );
}

export interface OperatingDayMessages {
    readonly opensInvalid: string;
    readonly closesInvalid: string;
    readonly closesBeforeOpens: string;
    readonly cutOffInvalid: string;
    readonly cutOffAfterCloses: string;
}

/**
 * What is wrong with each day, keyed by weekday.
 *
 * Two rules, and deliberately not a third. A branch must close after it opens, and a same-day order
 * cut-off must not fall after closing time — an order accepted after the doors shut is an order
 * nobody can cook. A cut-off *before* opening is *not* an error: "order by 06:00 for delivery today"
 * is exactly how a meal-prep kitchen trades, and rejecting it would enforce a rule the business does
 * not have. A blank cut-off is legal and means "no same-day cut-off recorded"; blank opening or
 * closing times on an open day are not, because an open day with no hours is the ambiguity the
 * closed toggle exists to remove.
 */
export function operatingErrors(
    rows: readonly OperatingDayDraft[],
    messages: OperatingDayMessages,
): ReadonlyMap<number, string> {
    const errors = new Map<number, string>();

    for (const row of rows) {
        if (row.isClosed) continue;

        const opensAt = parseClockTime(row.opensAt);
        if (opensAt === null) {
            errors.set(row.weekday, messages.opensInvalid);
            continue;
        }
        const closesAt = parseClockTime(row.closesAt);
        if (closesAt === null) {
            errors.set(row.weekday, messages.closesInvalid);
            continue;
        }
        if (closesAt <= opensAt) {
            errors.set(row.weekday, messages.closesBeforeOpens);
            continue;
        }

        if (row.orderCutOffAt.trim() === '') continue;
        const cutOffAt = parseClockTime(row.orderCutOffAt);
        if (cutOffAt === null) {
            errors.set(row.weekday, messages.cutOffInvalid);
            continue;
        }
        if (cutOffAt > closesAt) errors.set(row.weekday, messages.cutOffAfterCloses);
    }

    return errors;
}

/** The week as `setBranchOperating` takes it: seven rows, in order, closed days carrying nulls. */
export function operatingRequest(
    rows: readonly OperatingDayDraft[],
): readonly BranchOperatingDay[] {
    return [...rows]
        .sort((left, right) => left.weekday - right.weekday)
        .map((row) =>
            row.isClosed
                ? { weekday: row.weekday, opensAt: null, closesAt: null, orderCutOffAt: null }
                : {
                      weekday: row.weekday,
                      opensAt: parseClockTime(row.opensAt),
                      closesAt: parseClockTime(row.closesAt),
                      orderCutOffAt:
                          row.orderCutOffAt.trim() === ''
                              ? null
                              : parseClockTime(row.orderCutOffAt),
                  },
        );
}

export interface OperatingSummary {
    readonly openDays: number;
    readonly closedDays: number;
    /** Open days that state a same-day cut-off. The rest inherit nothing — they simply have none. */
    readonly withCutOff: number;
}

export function summariseOperating(rows: readonly OperatingDayDraft[]): OperatingSummary {
    let openDays = 0;
    let withCutOff = 0;
    for (const row of rows) {
        if (row.isClosed) continue;
        openDays += 1;
        if (row.orderCutOffAt.trim() !== '') withCutOff += 1;
    }
    return { openDays, closedDays: rows.length - openDays, withCutOff };
}

/* ------------------------------------------------------------------------------------------------
 * Service areas
 * ---------------------------------------------------------------------------------------------- */

/** One group of the gazetteer picker: a governorate, emirate or city, and the areas inside it. */
export interface ServiceAreaGroup {
    /** The parent's own name, or `null` for the areas that sit at the top of the hierarchy. */
    readonly parentName: LocalisedText | null;
    readonly key: string;
    readonly areas: readonly ServiceArea[];
}

/**
 * Groups the gazetteer by parent, preserving the order the areas arrived in.
 *
 * A flat list of 125 names is a scrolling exercise; the same list under eight headings is a place
 * somebody can find Jumeirah without reading Ras Al Khor. The grouping is derived rather than
 * requested because `ServiceArea.parentName` is the only hierarchy the contract publishes — there is
 * no parent *identifier*, so two areas are siblings exactly when their parent names match.
 */
export function groupServiceAreas(areas: readonly ServiceArea[]): readonly ServiceAreaGroup[] {
    const groups = new Map<string, { parentName: LocalisedText | null; areas: ServiceArea[] }>();

    for (const area of areas) {
        const key = area.parentName === null ? '' : `${area.parentName.en}|${area.parentName.ar}`;
        const group = groups.get(key) ?? { parentName: area.parentName, areas: [] };
        group.areas.push(area);
        groups.set(key, group);
    }

    return [...groups.entries()].map(([key, group]) => ({
        key: key === '' ? 'top' : key,
        parentName: group.parentName,
        areas: group.areas,
    }));
}

/**
 * Case- and diacritic-insensitive substring match over both languages and the parent's name.
 *
 * `localeCompare` is the wrong tool — this is a filter, not a sort — and Arabic search text is
 * routinely typed without the diacritics the catalogue carries, so both sides are normalised through
 * `NFD` with the combining marks stripped before the comparison. Matching the *parent* as well means
 * typing "Dubai" narrows to everything inside Dubai, which is what somebody selecting a delivery
 * area actually wants.
 */
export function areaMatches(area: ServiceArea, query: string): boolean {
    const needle = foldForSearch(query);
    if (needle === '') return true;
    const haystack = [area.name.en, area.name.ar, area.parentName?.en, area.parentName?.ar]
        .filter((value): value is string => value !== undefined)
        .map(foldForSearch);
    return haystack.some((value) => value.includes(needle));
}

/**
 * Case-folds and strips the combining marks a search box will not have been given.
 *
 * Written as an explicit code-point walk rather than a regular expression: the two ranges are the
 * Latin accents (U+0300-U+036F) and the Arabic harakat (U+064B-U+0652), and expressing them as a
 * character class means putting bare combining marks in the source of this file, where an editor,
 * a diff or a copy-paste can reorder them invisibly.
 */
function foldForSearch(value: string): string {
    let folded = '';
    for (const character of value.trim().toLocaleLowerCase().normalize('NFD')) {
        const code = character.codePointAt(0) ?? 0;
        const isLatinMark = code >= 0x0300 && code <= 0x036f;
        const isArabicHarakat = code >= 0x064b && code <= 0x0652;
        if (!isLatinMark && !isArabicHarakat) folded += character;
    }
    return folded;
}

/**
 * Adds or removes one area, keeping the selection in the gazetteer's own order.
 *
 * Order matters less than stability: `setZoneAreas` takes a list and the server echoes it back, so a
 * selection that reordered itself on every toggle would make the chips jump under the reader's hand
 * for no reason.
 */
export function toggleArea(
    selected: readonly ServiceAreaId[],
    areaId: ServiceAreaId,
    isSelected: boolean,
    gazetteer: readonly ServiceArea[],
): readonly ServiceAreaId[] {
    if (!isSelected) return selected.filter((candidate) => candidate !== areaId);
    if (selected.includes(areaId)) return selected;

    const order = new Map(gazetteer.map((area, index) => [String(area.id), index]));
    return [...selected, areaId].sort(
        (left, right) =>
            (order.get(String(left)) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(String(right)) ?? Number.MAX_SAFE_INTEGER),
    );
}

/** The zone's current areas as identifiers, which is what the setter takes. */
export function zoneAreaIds(zone: DeliveryZoneAdmin): readonly ServiceAreaId[] {
    return zone.areas.map((area) => area.id);
}
