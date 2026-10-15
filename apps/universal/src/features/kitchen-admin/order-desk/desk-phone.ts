import { DIALING_CODES, nationalDigits, withoutTrunkPrefix } from '../../account/phone.ts';

/**
 * The telephone number a desk agent types for a caller.
 *
 * The field opens with the kitchen's own country code filled in, so the agent types only what the
 * caller reads out. What is checked here is what the agent can fix while the caller is still on the
 * line: a missing `+` and country code, and — for the markets whose length the desk has been told —
 * a number with too few or too many digits. The server still decides whether a number is usable.
 *
 * Lebanon is 7 or 8 digits after `+961`: `70 123 456` (8) and the older `03 123 456` (7, the `0` is
 * the trunk prefix and is dropped) are both mobiles, and landlines are 7.
 */
const NATIONAL_DIGITS: Readonly<Record<string, { readonly min: number; readonly max: number }>> = {
    '+961': { min: 7, max: 8 },
};

/** The server's own rule (`ContactValueNormaliser`): a `+` and 8 to 15 digits. */
const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

export interface DeskPhoneProblem {
    readonly key:
        | 'kitchen:desk.sale.phoneCountryCode'
        | 'kitchen:desk.sale.phoneLength'
        | 'kitchen:desk.sale.phoneInvalid';
    readonly params: Readonly<Record<string, string | number>>;
}

/** The kitchen's dialling code, from its country; `null` for a country the list does not know. */
export function dialFor(countryCode: string | null): string | null {
    if (countryCode === null) return null;
    return DIALING_CODES.find((code) => code.country === countryCode)?.dial ?? null;
}

/** True while the field holds nothing but the code it opened with. */
export function isBlankPhone(value: string, dial: string | null): boolean {
    const typed = value.trim();
    return typed === '' || (dial !== null && nationalDigits(typed) === nationalDigits(dial));
}

/** The longest known code the typed digits start with, so `+961…` never reads as `+9…`. */
function knownDial(digits: string): string | null {
    const match = DIALING_CODES.map((code) => code.dial)
        .filter((dial) => digits.startsWith(dial.slice(1)))
        .sort((left, right) => right.length - left.length)[0];
    return match ?? null;
}

/** What is wrong with the number as typed, or `null` when it can be sent. */
export function checkDeskPhone(value: string, dial: string | null): DeskPhoneProblem | null {
    const typed = value.trim();
    const example = dial ?? '+961';

    if (!typed.startsWith('+')) {
        return { key: 'kitchen:desk.sale.phoneCountryCode', params: { dial: example } };
    }

    const digits = nationalDigits(typed);
    const code = knownDial(digits);
    const rule = code === null ? undefined : NATIONAL_DIGITS[code];

    if (code !== null && rule !== undefined) {
        const national = withoutTrunkPrefix(digits.slice(code.length - 1));
        return national.length >= rule.min && national.length <= rule.max
            ? null
            : {
                  key: 'kitchen:desk.sale.phoneLength',
                  params: { dial: code, min: rule.min, max: rule.max },
              };
    }

    return digits.length >= E164_MIN_DIGITS && digits.length <= E164_MAX_DIGITS
        ? null
        : { key: 'kitchen:desk.sale.phoneInvalid', params: {} };
}

/**
 * The number as the server stores it: `+961 03-123 456` → `+9613123456`. Spaces, dashes and the
 * trunk `0` after a known code are dropped; anything else is sent as typed for the server to judge.
 */
export function normaliseDeskPhone(value: string): string {
    const digits = nationalDigits(value);
    const code = knownDial(digits);
    if (code === null) return value.trim().startsWith('+') ? `+${digits}` : value.trim();
    return `${code}${withoutTrunkPrefix(digits.slice(code.length - 1))}`;
}
