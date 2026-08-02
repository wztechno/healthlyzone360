/**
 * Phone-number entry, as arithmetic rather than as opinion.
 *
 * `ContactPoint.value` is E.164 for a phone (`contracts/verification.ts`) — a `+`, a country
 * calling code, and a national number, with no spaces, dashes or brackets. That is one string, and
 * a single free-text field for it is a reliable way to collect `05 0123 4567`, `00971501234567` and
 * `(050) 123-4567`, all of which are the same number and none of which is E.164.
 *
 * So the screen collects two things — a country from a closed list, and the national digits — and
 * composes them here. The rules below are deliberately shallow: this module knows how to *assemble*
 * an E.164 string and how to reject something that cannot possibly be one. It does **not** know
 * whether `+971 50 …` is an allocated mobile prefix, and it must not pretend to: real numbering
 * plans change, and a client that guessed would refuse valid numbers in whichever market it had not
 * been taught about.
 *
 * The server is the authority on whether a number is usable — it is the one that has to deliver a
 * message to it, and it says so by refusing the contact or by the code never arriving.
 */

export interface DialingCode {
    /** ISO 3166-1 alpha-2, used as the option value and the flag-free label prefix. */
    readonly country: string;
    /** With the leading `+`, as it appears in E.164. */
    readonly dial: string;
}

/**
 * The countries the demo markets cover, plus their neighbours.
 *
 * A closed list rather than all ~250, because this is a fixture-era screen and a 250-row select is
 * a worse experience than a short one that covers the markets the product actually serves. It is
 * ordered rather than alphabetical: the two markets the mock world models come first.
 *
 * TODO(market configuration): a real deployment reads this from the platform's market list rather
 * than from a constant, and defaults it from the person's market rather than from the head of the
 * array. Recorded rather than disguised — a hard-coded default country is a small lie about how
 * much the application knows about where somebody is.
 */
export const DIALING_CODES: readonly DialingCode[] = [
    { country: 'AE', dial: '+971' },
    { country: 'LB', dial: '+961' },
    { country: 'SA', dial: '+966' },
    { country: 'KW', dial: '+965' },
    { country: 'QA', dial: '+974' },
    { country: 'BH', dial: '+973' },
    { country: 'OM', dial: '+968' },
    { country: 'JO', dial: '+962' },
    { country: 'EG', dial: '+20' },
    { country: 'GB', dial: '+44' },
];

/** The head of the list. See the TODO above — this is a fixture default, not a detection. */
export const DEFAULT_DIALING_CODE: DialingCode = DIALING_CODES[0] as DialingCode;

/** E.164 allows at most fifteen digits including the country code. */
const E164_MAX_DIGITS = 15;
/** Nothing shorter than four national digits is a phone number anywhere. */
const MIN_NATIONAL_DIGITS = 4;

/** Everything that is not a digit, dropped. Callers paste from address books; address books format. */
export function nationalDigits(input: string): string {
    return input.replace(/\D/g, '');
}

/**
 * Strips the trunk prefix a person types out of habit.
 *
 * `050 123 4567` is how a number is written and said inside the UAE; the `0` is a domestic trunk
 * code and is *not* part of the international form. Leaving it in produces `+9710501234567`, which
 * is a different number and reaches nobody. Dropping it silently is right here — every market in
 * {@link DIALING_CODES} uses a leading `0` this way, and a person who typed one meant the number
 * they say out loud.
 */
export function withoutTrunkPrefix(digits: string): string {
    return digits.startsWith('0') ? digits.replace(/^0+/, '') : digits;
}

/** `+971` + `501234567`. Returns `null` when the parts cannot form an E.164 number. */
export function toE164(dial: string, national: string): string | null {
    const digits = withoutTrunkPrefix(nationalDigits(national));
    if (digits.length < MIN_NATIONAL_DIGITS) return null;
    const composed = `${dial}${digits}`;
    return nationalDigits(composed).length > E164_MAX_DIGITS ? null : composed;
}

export const PHONE_ERROR_KEYS = {
    empty: 'account:phone.errors.empty',
    tooShort: 'account:phone.errors.tooShort',
    tooLong: 'account:phone.errors.tooLong',
} as const;

export type PhoneErrorKey = (typeof PHONE_ERROR_KEYS)[keyof typeof PHONE_ERROR_KEYS];

/**
 * The one validation the client is entitled to perform.
 *
 * Length only. Anything more — prefix tables, carrier ranges — is the numbering plan's business and
 * changes without notice; a client that enforced it would reject working numbers and would have to
 * be redeployed to stop.
 */
export function validatePhone(dial: string, national: string): PhoneErrorKey | null {
    const digits = withoutTrunkPrefix(nationalDigits(national));
    if (digits.length === 0) return PHONE_ERROR_KEYS.empty;
    if (digits.length < MIN_NATIONAL_DIGITS) return PHONE_ERROR_KEYS.tooShort;
    if (nationalDigits(`${dial}${digits}`).length > E164_MAX_DIGITS)
        return PHONE_ERROR_KEYS.tooLong;
    return null;
}
