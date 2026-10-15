import { isValidationFailure } from '@healthy360/api-client';
import type { ApiFailure } from '@healthy360/api-client';
import type { FormIssueItem } from '@healthy360/design-system';

import { focusField } from './field-focus.ts';

/**
 * A server refusal, put back on the fields it is about.
 *
 * A `validation.failed` save carries one message per refused field (`details.fields`, keyed by the
 * request's own field names — `name_ar`, `email`, `lines.2.quantity`). Shown only as the envelope's
 * "The submitted data is invalid." in a callout, it leaves the reader hunting for which field the
 * server meant (BUG-06). This puts each message under its field and names the field in the form's
 * issue banner, the way the form's own "required" checks already do.
 *
 * A form describes its fields once, server name → where it lives on the screen:
 *
 * ```ts
 * const server = serverFieldErrors(saveFailure, {
 *     name_ar: { label: t('…'), fieldId: 'kitchen-ingredient-name-ar' },
 *     'lines.*.quantity': { label: t('…'), fieldId: 'kitchen-order-lines' },
 * });
 * <TextInputField id="kitchen-ingredient-name-ar" {...server.flag('name_ar')} … />
 * ```
 *
 * `*` stands for one path segment, so a table of rows is one entry. Anything the server refused
 * that the form did not describe comes back as `unplaced`, for the save callout: a rejection that
 * maps to nothing must still reach the reader.
 */
export interface ServerFieldTarget {
    /** The field's own label, already translated — what the reader will find on the form. */
    readonly label: string;
    /** The control's element id: the chip focuses it. */
    readonly fieldId: string;
}

export interface ServerFieldErrors {
    /** True when the failure was a field validation refusal at all. */
    readonly isValidation: boolean;
    /** The server's message for a field, by its server name or a row path (`lines.2.quantity`). */
    readonly errorFor: (serverField: string) => string | undefined;
    /** `{ error }` for a field the server refused, `{}` otherwise — spread onto the control. */
    readonly flag: (serverField: string) => { readonly error?: string };
    /** One chip per described field the server refused, for the form's danger issue banner. */
    readonly items: readonly FormIssueItem[];
    /** Messages for fields the form did not describe, joined; `null` when every one was placed. */
    readonly unplaced: string | null;
}

const NONE: ServerFieldErrors = {
    isValidation: false,
    errorFor: () => undefined,
    flag: () => ({}),
    items: [],
    unplaced: null,
};

export function serverFieldErrors(
    failure: ApiFailure | null,
    targets: Readonly<Record<string, ServerFieldTarget>> = {},
): ServerFieldErrors {
    if (failure === null || !isValidationFailure(failure)) return NONE;

    const refused = Object.entries(failure.fields).filter(([, messages]) => messages.length > 0);
    const patterns = Object.keys(targets);

    const matchOf = (serverField: string): string | undefined =>
        patterns.find((pattern) => matches(pattern, serverField));

    const errorFor = (serverField: string): string | undefined => {
        const exact = failure.fields[serverField];
        if (exact !== undefined && exact.length > 0) return exact.join(' ');
        // A wildcard asked for directly (`lines.*.quantity`) answers with the first row refused.
        const row = refused.find(([field]) => matches(serverField, field));
        return row?.[1].join(' ');
    };

    const items: FormIssueItem[] = [];
    const seen = new Set<string>();
    const leftovers: string[] = [];

    for (const [field, messages] of refused) {
        const pattern = matchOf(field);
        const target = pattern === undefined ? undefined : targets[pattern];
        if (pattern === undefined || target === undefined) {
            leftovers.push(...messages);
            continue;
        }
        if (seen.has(pattern)) continue;
        seen.add(pattern);
        items.push({
            key: `server-${pattern}`,
            label: target.label,
            // No `fieldId`: the chip only names the field, and the server's message is the one
            // place that says what is wrong with it, so the field keeps saying it.
            onPress: () => {
                focusField(target.fieldId);
            },
        });
    }

    return {
        isValidation: true,
        errorFor,
        flag: (serverField) => {
            const message = errorFor(serverField);
            return message === undefined ? {} : { error: message };
        },
        items,
        // A refusal that names no field at all still has to say something.
        unplaced:
            refused.length === 0
                ? failure.message
                : leftovers.length === 0
                  ? null
                  : leftovers.join(' '),
    };
}

/** `lines.*.quantity` matches `lines.2.quantity`; a plain name matches only itself. */
function matches(pattern: string, field: string): boolean {
    if (!pattern.includes('*')) return pattern === field;
    const want = pattern.split('.');
    const have = field.split('.');
    return want.length === have.length && want.every((part, i) => part === '*' || part === have[i]);
}
