import { isValidationFailure } from '@healthy360/api-client';
import type { ApiFailure } from '@healthy360/api-client';
import { mapLaravelValidationErrors } from '@healthy360/validation';
import type { SetFieldError, Translate } from '@healthy360/validation';
import { useCallback, useMemo, useState } from 'react';
import type { FieldValues, UseFormSetError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

/**
 * Adapters between React Hook Form, i18next and the repository failure contract.
 *
 * Each of the three has a slightly different idea of the same thing — a translate function, a
 * field-error setter, a validation failure — and the mismatches are structural rather than
 * semantic. Converting once here keeps six screens from each inventing their own cast.
 */

/**
 * i18next's `t` is overloaded far beyond what the validation schemas need, and its overloads do not
 * structurally satisfy the two-argument `Translate` the schemas ask for. Narrowing it is safe: the
 * schemas only ever call it with a key and a flat interpolation map.
 */
export function useValidationTranslate(): Translate {
    const { t } = useTranslation();
    return useMemo<Translate>(
        () => (key, params) => (params === undefined ? t(key) : t(key, params)),
        [t],
    );
}

/**
 * React Hook Form types `setError`'s path as a union of the form's own field paths; the envelope
 * mapper works with plain strings because the server does not know the form's type. The names that
 * survive `knownFields` filtering are exactly the form's own, so the widening is sound.
 */
export function toSetFieldError<TFieldValues extends FieldValues>(
    setError: UseFormSetError<TFieldValues>,
): SetFieldError {
    return (name, error, options) => {
        // `exactOptionalPropertyTypes` makes `{ shouldFocus: undefined }` and "absent" different
        // types, so the option is spread in only when it was actually supplied.
        if (options?.shouldFocus === undefined) {
            setError(name as never, error);
            return;
        }
        setError(name as never, error, { shouldFocus: options.shouldFocus });
    };
}

/**
 * Applies a `validation.failed` rejection to a form, returning any message that could not be
 * attached to a field the form owns.
 *
 * A server rejection that maps to nothing must still reach the user — silently dropping it is the
 * failure mode that matters — so the leftovers come back for banner display rather than being set
 * on a phantom field that would never render.
 */
export function applyServerFailure<TFieldValues extends FieldValues>(
    failure: ApiFailure | null,
    setError: UseFormSetError<TFieldValues>,
    knownFields: readonly string[],
): string | null {
    if (failure === null || !isValidationFailure(failure)) return null;

    const result = mapLaravelValidationErrors(
        { error: { details: failure.fields } },
        toSetFieldError(setError),
        { knownFields, rootPath: '__unmapped__', shouldFocusFirst: true },
    );

    if (result.unmapped.length === 0) return null;
    return result.unmapped.flatMap((field) => failure.fields[field] ?? []).join(' ');
}

export interface FieldErrorsState {
    readonly formError: string | null;
    readonly setFormError: (message: string | null) => void;
}

/** Form-level (non-field) error message state. */
export function useFieldErrors(): FieldErrorsState {
    const [formError, setValue] = useState<string | null>(null);
    const setFormError = useCallback((message: string | null) => {
        setValue(message);
    }, []);
    return { formError, setFormError };
}

/** Turns a non-field failure into displayable copy, preferring the translated code. */
export function useFailureMessage(): (failure: ApiFailure | null) => string | null {
    const { t } = useTranslation();
    return useCallback(
        (failure: ApiFailure | null) => {
            if (failure === null) return null;
            if (failure.code === 'rate_limit.exceeded') {
                return t('errors:failure.rate_limit_exceeded', {
                    seconds: failure.retryAfterSeconds,
                });
            }
            return t(`errors:failure.${failure.code.replace(/\./g, '_')}`, {
                defaultValue: failure.message,
            });
        },
        [t],
    );
}
