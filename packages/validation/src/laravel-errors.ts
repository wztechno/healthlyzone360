/**
 * Maps the API's error envelope onto React Hook Form field paths.
 *
 * The backend returns `{ error: { code, message, details: { field: [messages] }, correlation_id } }`
 * (plan §14). Laravel's field keys already use dot/index notation (`profile.name`, `items.0.qty`),
 * which is exactly React Hook Form's path syntax, so the mapping is a direct transfer — the work is
 * in validating the envelope shape and in deciding where *unmappable* errors go, because silently
 * dropping a server rejection is the failure mode that matters.
 */

/** Structural mirror of React Hook Form's `setError`, so this module needs no RHF import. */
export type SetFieldError = (
    name: string,
    error: { type: string; message: string },
    options?: { shouldFocus?: boolean },
) => void;

export interface ErrorEnvelope {
    readonly error: {
        readonly code?: string;
        readonly message?: string;
        readonly details?: Readonly<Record<string, readonly string[]>>;
        readonly correlation_id?: string;
    };
}

export interface MapLaravelErrorsOptions {
    /**
     * Field paths the form actually owns. Anything outside this list is redirected to `rootPath`
     * instead of creating a phantom field error that never renders.
     */
    readonly knownFields?: readonly string[];
    /** Where unmappable errors land. Defaults to RHF's form-level `root` error. */
    readonly rootPath?: string;
    /** Focus the first field that received an error. */
    readonly shouldFocusFirst?: boolean;
    /** How multiple messages for one field are combined. Defaults to joining with a space. */
    readonly joinMessages?: (messages: readonly string[]) => string;
}

export interface MapLaravelErrorsResult {
    /** Field paths that were set on the form, in envelope order. */
    readonly mapped: readonly string[];
    /** Field paths the form does not own; their messages were folded into the root error. */
    readonly unmapped: readonly string[];
    /** True when at least one error was surfaced somewhere. */
    readonly handled: boolean;
}

const DEFAULT_ROOT_PATH = 'root';
const ERROR_TYPE = 'server';

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = (value as { error?: unknown }).error;
    return typeof candidate === 'object' && candidate !== null;
}

/** Pulls the field → messages map out of an envelope, tolerating a missing or malformed `details`. */
export function extractValidationDetails(
    envelope: unknown,
): Readonly<Record<string, readonly string[]>> {
    if (!isErrorEnvelope(envelope)) return {};
    const details = envelope.error.details;
    if (typeof details !== 'object' || details === null) return {};

    const cleaned: Record<string, readonly string[]> = {};
    for (const [field, messages] of Object.entries(details)) {
        if (typeof field !== 'string' || field.length === 0) continue;
        if (Array.isArray(messages)) {
            const strings = messages.filter(
                (message): message is string => typeof message === 'string',
            );
            if (strings.length > 0) cleaned[field] = strings;
        } else if (typeof messages === 'string') {
            cleaned[field] = [messages];
        }
    }
    return cleaned;
}

export function mapLaravelValidationErrors(
    envelope: unknown,
    setError: SetFieldError,
    options: MapLaravelErrorsOptions = {},
): MapLaravelErrorsResult {
    const {
        knownFields,
        rootPath = DEFAULT_ROOT_PATH,
        shouldFocusFirst = true,
        joinMessages = (messages) => messages.join(' '),
    } = options;

    const details = extractValidationDetails(envelope);
    const known = knownFields === undefined ? null : new Set(knownFields);

    const mapped: string[] = [];
    const unmapped: string[] = [];
    const rootMessages: string[] = [];

    for (const [field, messages] of Object.entries(details)) {
        const message = joinMessages(messages);
        if (known !== null && !known.has(field)) {
            unmapped.push(field);
            rootMessages.push(message);
            continue;
        }
        setError(
            field,
            { type: ERROR_TYPE, message },
            { shouldFocus: shouldFocusFirst && mapped.length === 0 },
        );
        mapped.push(field);
    }

    // A rejection with no usable `details` still has to reach the user; fall back to the envelope's
    // human-readable message so the form never fails silently.
    if (mapped.length === 0 && rootMessages.length === 0 && isErrorEnvelope(envelope)) {
        const fallback = envelope.error.message;
        if (typeof fallback === 'string' && fallback.length > 0) rootMessages.push(fallback);
    }

    if (rootMessages.length > 0) {
        setError(rootPath, { type: ERROR_TYPE, message: joinMessages(rootMessages) });
    }

    return {
        mapped,
        unmapped,
        handled: mapped.length > 0 || rootMessages.length > 0,
    };
}
