/**
 * The arithmetic behind `TimeField`, platform-neutral so it is tested without rendering.
 *
 * Values are ISO `HH:mm` (24-hour, zero-padded) or `''` for no time. Nothing here localises: what
 * a person types is read leniently, what is stored is always the one shape.
 */

/** Arabic-Indic and Eastern Arabic-Indic digits, read as their Latin values. */
const DIGIT_MAP: Readonly<Record<string, string>> = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
    '۰': '0',
    '۱': '1',
    '۲': '2',
    '۳': '3',
    '۴': '4',
    '۵': '5',
    '۶': '6',
    '۷': '7',
    '۸': '8',
    '۹': '9',
};

const pad = (value: number): string => String(value).padStart(2, '0');

export function isoTime(hour: number, minute: number): string {
    return `${pad(hour)}:${pad(minute)}`;
}

/** `{hour, minute}` from an ISO value, or `null` for `''` or anything malformed. */
export function timeParts(
    value: string,
): { readonly hour: number; readonly minute: number } | null {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (match === null) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
}

/**
 * What a person typed, as ISO — or `''` for an empty field, or `null` when it is not a time.
 *
 * Accepts `9:30`, `09:30`, `930`, `0930`, `9.30`, `9`, `21h30` and the same in Arabic digits: the
 * field is typed far more often than the panel is opened, and a kitchen manager writing `930` means
 * half past nine. Twenty-four hour only; there is no AM/PM to guess at.
 */
export function parseTypedTime(input: string): string | null {
    const latin = [...input.trim()].map((char) => DIGIT_MAP[char] ?? char).join('');
    if (latin === '') return '';

    let hour: number;
    let minute: number;
    const separated = /^(\d{1,2})\s*[:.hH]\s*(\d{1,2})$/.exec(latin);
    if (separated !== null) {
        hour = Number(separated[1]);
        minute = Number(separated[2]);
        if ((separated[2] ?? '').length === 1) return null;
    } else if (/^\d{1,4}$/.test(latin)) {
        if (latin.length <= 2) {
            hour = Number(latin);
            minute = 0;
        } else {
            hour = Number(latin.slice(0, latin.length - 2));
            minute = Number(latin.slice(-2));
        }
    } else {
        return null;
    }

    if (hour > 23 || minute > 59) return null;
    return isoTime(hour, minute);
}

/** Minutes since midnight. */
function toMinutes(value: string): number | null {
    const parts = timeParts(value);
    return parts === null ? null : parts.hour * 60 + parts.minute;
}

/** Moves a time by `delta` minutes, wrapping at midnight. An empty value starts from `00:00`. */
export function stepTime(value: string, delta: number): string {
    const start = toMinutes(value) ?? 0;
    const total = (((start + delta) % 1440) + 1440) % 1440;
    return isoTime(Math.floor(total / 60), total % 60);
}

/** Whether a time falls inside inclusive ISO bounds; an absent bound is open. */
export function isWithin(value: string, min?: string, max?: string): boolean {
    const at = toMinutes(value);
    if (at === null) return false;
    const low = min === undefined || min === '' ? null : toMinutes(min);
    const high = max === undefined || max === '' ? null : toMinutes(max);
    if (low !== null && at < low) return false;
    if (high !== null && at > high) return false;
    return true;
}

/** The minute column: `0, step, 2·step …` below sixty. A step that does not divide 60 still works. */
export function minuteOptions(step: number): readonly number[] {
    const safe = Math.min(Math.max(Math.round(step), 1), 60);
    const options: number[] = [];
    for (let minute = 0; minute < 60; minute += safe) options.push(minute);
    return options;
}

/** Whether any listed minute of `hour` is inside the bounds — an hour with none cannot be chosen. */
export function hourHasRoom(
    hour: number,
    minutes: readonly number[],
    min?: string,
    max?: string,
): boolean {
    return minutes.some((minute) => isWithin(isoTime(hour, minute), min, max));
}
