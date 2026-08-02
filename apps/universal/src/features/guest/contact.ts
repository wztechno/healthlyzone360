import type { Translate } from '@healthy360/validation';
import { z } from 'zod';

/**
 * The guest's contact details, as a form.
 *
 * ## The rule this module exists for
 *
 * A guest must give a name and **at least one** of an email address or a mobile number. Not both,
 * and not a specific one: an order needs a way to say "the driver is downstairs" and either channel
 * carries that. Expressing it as "both optional" would let somebody through with neither, and
 * expressing it as "email required" would turn away every person who orders by phone.
 *
 * The rule is about the *pair*, so when it fails the message lands on **both** fields. Attaching it
 * to one of them would mark an input invalid that the person is not obliged to fill in, and they
 * would fix the wrong box.
 *
 * ## Why the checks are this shallow
 *
 * The email check is a shape check and the mobile check is an E.164 shape check — nothing here
 * decides whether an address exists or a number is reachable. It cannot: the only real test is
 * sending a code to it, which is the very next step of the journey. A stricter client-side regex
 * would buy nothing and would reject real addresses, which is a worse trade than letting a typo
 * reach the step designed to catch it.
 */

export const GUEST_CONTACT_CHANNELS = ['email', 'sms', 'whatsapp'] as const;
export type GuestContactChannel = (typeof GUEST_CONTACT_CHANNELS)[number];

export interface GuestContactValues {
    readonly fullName: string;
    readonly email: string;
    readonly mobile: string;
    readonly channel: GuestContactChannel;
}

export const GUEST_CONTACT_FIELDS = ['fullName', 'email', 'mobile', 'channel'] as const;
export type GuestContactField = (typeof GUEST_CONTACT_FIELDS)[number];

export const EMPTY_GUEST_CONTACT: GuestContactValues = {
    fullName: '',
    email: '',
    mobile: '',
    channel: 'email',
};

const KEYS = {
    nameRequired: 'guest:contact.errors.nameRequired',
    contactRequired: 'guest:contact.errors.contactRequired',
    emailInvalid: 'guest:contact.errors.emailInvalid',
    mobileInvalid: 'guest:contact.errors.mobileInvalid',
} as const;

/** An `@` with something either side and a dot in the domain. Deliberately not RFC 5322. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164: a leading `+` and 8–15 digits. The same strictness the backend applies. */
const E164_SHAPE = /^\+[1-9]\d{7,14}$/;

/**
 * Built per render from `t`, for the reason every schema in this codebase is: a schema constructed
 * at import time freezes whichever language happened to be active when the module was evaluated.
 */
export function makeGuestContactSchema(t: Translate) {
    return z
        .object({
            fullName: z
                .string()
                .trim()
                .min(1, { error: t(KEYS.nameRequired) })
                .max(120, { error: t(KEYS.nameRequired) }),
            email: z.string().trim(),
            mobile: z.string().trim(),
            channel: z.enum(GUEST_CONTACT_CHANNELS),
        })
        .superRefine((values, ctx) => {
            const email = values.email.trim();
            const mobile = values.mobile.trim();

            if (email.length === 0 && mobile.length === 0) {
                // Both, because the requirement is about the pair. See the header.
                for (const path of ['email', 'mobile'] as const) {
                    ctx.addIssue({
                        code: 'custom',
                        path: [path],
                        message: t(KEYS.contactRequired),
                    });
                }
                return;
            }

            if (email.length > 0 && !EMAIL_SHAPE.test(email)) {
                ctx.addIssue({ code: 'custom', path: ['email'], message: t(KEYS.emailInvalid) });
            }
            if (mobile.length > 0 && !E164_SHAPE.test(mobile)) {
                ctx.addIssue({ code: 'custom', path: ['mobile'], message: t(KEYS.mobileInvalid) });
            }
        });
}

export type GuestContactErrors = Partial<Record<GuestContactField, string>>;

/** Field-keyed messages, empty when the details are usable. Never throws on partial input. */
export function validateGuestContact(values: GuestContactValues, t: Translate): GuestContactErrors {
    const result = makeGuestContactSchema(t).safeParse(values);
    if (result.success) return {};

    const errors: GuestContactErrors = {};
    for (const issue of result.error.issues) {
        const [field] = issue.path;
        if (typeof field !== 'string') continue;
        if (!(GUEST_CONTACT_FIELDS as readonly string[]).includes(field)) continue;
        const key = field as GuestContactField;
        if (errors[key] === undefined) errors[key] = issue.message;
    }
    return errors;
}

export function isGuestContactComplete(values: GuestContactValues, t: Translate): boolean {
    return Object.keys(validateGuestContact(values, t)).length === 0;
}

/**
 * The channels a set of values can actually carry a code on.
 *
 * Derived from what was typed, not from a preference: offering SMS to somebody who gave only an
 * email address is offering a message that cannot be sent. The *server* still has the last word —
 * it answers with the channel it used — but the picker should not present an impossible option in
 * the first place.
 */
export function availableChannels(values: GuestContactValues): readonly GuestContactChannel[] {
    const channels: GuestContactChannel[] = [];
    if (values.email.trim().length > 0) channels.push('email');
    if (values.mobile.trim().length > 0) channels.push('sms', 'whatsapp');
    return channels;
}

/**
 * The channel to send on, given what was typed and what was asked for.
 *
 * A person who chose SMS and then deleted their number has not chosen an impossible thing on
 * purpose; they have moved on. Falling back to the first channel that works is more honest than
 * refusing, and the confirmation step names the channel that was actually used either way.
 */
export function resolveChannel(values: GuestContactValues): GuestContactChannel | null {
    const available = availableChannels(values);
    if (available.includes(values.channel)) return values.channel;
    return available[0] ?? null;
}

/** The request shape, with `''` collapsed to absent so "empty string" never reaches a server. */
export function toContactRequest(values: GuestContactValues): {
    readonly fullName: string;
    readonly email?: string | undefined;
    readonly mobile?: string | undefined;
    readonly preferredChannel?: GuestContactChannel | undefined;
} {
    const email = values.email.trim();
    const mobile = values.mobile.trim();
    const channel = resolveChannel(values);
    return {
        fullName: values.fullName.trim(),
        ...(email.length === 0 ? {} : { email }),
        ...(mobile.length === 0 ? {} : { mobile }),
        ...(channel === null ? {} : { preferredChannel: channel }),
    };
}
