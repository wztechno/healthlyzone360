import type { DeliveryAddress } from '@healthy360/api-client/contracts';
import type { Translate } from '@healthy360/validation';
import { z } from 'zod';

/**
 * The delivery address, as a form.
 *
 * ## Two shapes, on purpose
 *
 * `DeliveryAddress` (the contract) models absent optional lines as `null`. A text input models them
 * as `''`. Converting at the boundary — {@link toDeliveryAddress} and {@link fromDeliveryAddress} —
 * keeps `null` out of the inputs and `''` out of the request, and means a person who types a second
 * line and then clears it sends "there is no second line" rather than "the second line is empty
 * string", which are the same thing to a reader and different things to a database.
 *
 * ## Validated locally, and claiming nothing
 *
 * There is no address book in this prototype: `CommerceRepository` has no `saveAddress`, no
 * `listAddresses` and no address identifier anywhere in its vocabulary. So the form validates what
 * a person typed, sends it with the request that needs it, and the screens say plainly that nothing
 * is stored. The rules are ours rather than a mirror of a server's — recorded here rather than in
 * `@healthy360/validation`, which holds only the schemas an API contract is actually shaped by.
 */

export interface AddressValues {
    readonly label: string;
    readonly line1: string;
    readonly line2: string;
    readonly area: string;
    readonly city: string;
    readonly countryCode: string;
    readonly instructions: string;
}

export const ADDRESS_FIELDS = [
    'label',
    'line1',
    'line2',
    'area',
    'city',
    'countryCode',
    'instructions',
] as const;
export type AddressField = (typeof ADDRESS_FIELDS)[number];

/** Fields a person must supply. `line2` and `instructions` are genuinely optional. */
export const REQUIRED_ADDRESS_FIELDS: readonly AddressField[] = [
    'label',
    'line1',
    'area',
    'city',
    'countryCode',
];

export const EMPTY_ADDRESS: AddressValues = {
    label: '',
    line1: '',
    line2: '',
    area: '',
    city: '',
    countryCode: '',
    instructions: '',
};

const KEYS = {
    required: 'commerce:validation.required',
    tooLong: 'commerce:validation.tooLong',
    countryCode: 'commerce:validation.countryCode',
} as const;

const MAX_LINE = 120;
const MAX_INSTRUCTIONS = 240;

function requiredLine(t: Translate, max = MAX_LINE) {
    return z
        .string()
        .trim()
        .min(1, { error: t(KEYS.required) })
        .max(max, { error: t(KEYS.tooLong, { max }) });
}

function optionalLine(t: Translate, max = MAX_LINE) {
    return z
        .string()
        .trim()
        .max(max, { error: t(KEYS.tooLong, { max }) });
}

/**
 * Built per render from `t` rather than once at module load, for the reason every schema in this
 * codebase is: a schema constructed at import time freezes whichever language happened to be active
 * when the module was first evaluated.
 */
export function makeAddressSchema(t: Translate) {
    return z.object({
        label: requiredLine(t, 60),
        line1: requiredLine(t),
        line2: optionalLine(t),
        area: requiredLine(t, 80),
        city: requiredLine(t, 80),
        // ISO 3166-1 alpha-2, upper-cased before validation so `ae` is accepted and `AE` is sent.
        countryCode: z
            .string()
            .trim()
            .toUpperCase()
            .regex(/^[A-Z]{2}$/, { error: t(KEYS.countryCode) }),
        instructions: optionalLine(t, MAX_INSTRUCTIONS),
    });
}

export type AddressErrors = Partial<Record<AddressField, string>>;

/** Field-keyed messages, empty when the address is usable. Never throws on partial input. */
export function validateAddress(values: AddressValues, t: Translate): AddressErrors {
    const result = makeAddressSchema(t).safeParse(values);
    if (result.success) return {};

    const errors: AddressErrors = {};
    for (const issue of result.error.issues) {
        const [field] = issue.path;
        if (typeof field !== 'string') continue;
        if (!(ADDRESS_FIELDS as readonly string[]).includes(field)) continue;
        const key = field as AddressField;
        if (errors[key] === undefined) errors[key] = issue.message;
    }
    return errors;
}

export function isAddressComplete(values: AddressValues, t: Translate): boolean {
    return Object.keys(validateAddress(values, t)).length === 0;
}

/** Form values to the contract shape. `''` becomes `null`; the country code is normalised. */
export function toDeliveryAddress(values: AddressValues): DeliveryAddress {
    const line2 = values.line2.trim();
    const instructions = values.instructions.trim();
    return {
        label: values.label.trim(),
        line1: values.line1.trim(),
        line2: line2.length === 0 ? null : line2,
        area: values.area.trim(),
        city: values.city.trim(),
        countryCode: values.countryCode.trim().toLocaleUpperCase(),
        instructions: instructions.length === 0 ? null : instructions,
    };
}

/** The contract shape back into form values, for the change-address form's initial state. */
export function fromDeliveryAddress(address: DeliveryAddress): AddressValues {
    return {
        label: address.label,
        line1: address.line1,
        line2: address.line2 ?? '',
        area: address.area,
        city: address.city,
        countryCode: address.countryCode,
        instructions: address.instructions ?? '',
    };
}

/** One line, for a summary row. Empty parts are dropped rather than rendered as gaps. */
export function formatAddress(address: DeliveryAddress, separator = ', '): string {
    return [address.line1, address.line2, address.area, address.city, address.countryCode]
        .filter((part): part is string => part !== null && part.trim().length > 0)
        .join(separator);
}
