<?php

declare(strict_types=1);

namespace Healthy360\Support\Api;

/**
 * The stable, machine-readable error vocabulary of the Healthy360 API
 * (docs/api/conventions.md). Clients branch on these codes, never on
 * messages, so a value may only be added — never renamed or repurposed —
 * within `/api/v1`.
 *
 * Separated authorisation concerns (context, permission, step-up, email
 * verification, two-factor) each carry a distinct code and are never
 * collapsed into one generic denial.
 */
enum ErrorCode: string
{
    case ValidationFailed = 'validation.failed';

    case AuthUnauthenticated = 'auth.unauthenticated';
    case AuthInvalidCredentials = 'auth.invalid_credentials';
    case AuthEmailUnverified = 'auth.email_unverified';
    case AuthTwoFactorRequired = 'auth.two_factor_required';
    case AuthTwoFactorInvalid = 'auth.two_factor_invalid';
    case AuthStepUpRequired = 'auth.step_up_required';
    case AuthCsrfTokenMismatch = 'auth.csrf_token_mismatch';
    case AuthInvalidSignature = 'auth.invalid_signature';

    case ContextOrganisationRequired = 'context.organisation_required';
    case ContextOrganisationForbidden = 'context.organisation_forbidden';
    case ContextBranchOutOfScope = 'context.branch_out_of_scope';

    case AuthzPermissionDenied = 'authz.permission_denied';

    case RequestInvalid = 'request.invalid';

    /**
     * A write to a lock-versioned resource arrived without `If-Match`
     * (master plan v2 §4.13). Distinct from `resource.conflict`: the client
     * has not lost a race, it never entered one, and the fix is to read the
     * resource and retry with its validator rather than to reload and merge.
     */
    case RequestPreconditionRequired = 'request.precondition_required';

    case ResourceNotFound = 'resource.not_found';
    case ResourceConflict = 'resource.conflict';

    case RateLimitExceeded = 'rate_limit.exceeded';

    case ServerInternalError = 'server.internal_error';

    /**
     * The HTTP status this code is served with unless the thrower overrides
     * it. One code maps to exactly one status in this phase.
     */
    public function status(): int
    {
        return match ($this) {
            self::ContextOrganisationRequired, self::RequestInvalid => 400,
            self::AuthUnauthenticated => 401,
            self::AuthEmailUnverified,
            self::AuthTwoFactorRequired,
            self::AuthStepUpRequired,
            self::AuthInvalidSignature,
            self::ContextOrganisationForbidden,
            self::ContextBranchOutOfScope,
            self::AuthzPermissionDenied => 403,
            self::ResourceNotFound => 404,
            self::ResourceConflict => 409,
            self::RequestPreconditionRequired => 428,
            self::AuthCsrfTokenMismatch => 419,
            self::ValidationFailed,
            self::AuthInvalidCredentials,
            self::AuthTwoFactorInvalid => 422,
            self::RateLimitExceeded => 429,
            self::ServerInternalError => 500,
        };
    }

    /**
     * A safe, human-readable summary. Never a stack trace, never another
     * tenant's data, and never a hint about whether an account exists.
     */
    public function message(): string
    {
        return match ($this) {
            self::ValidationFailed => 'The submitted data is invalid.',
            self::AuthUnauthenticated => 'Authentication is required for this endpoint.',
            self::AuthInvalidCredentials => 'These credentials do not match our records.',
            self::AuthEmailUnverified => 'Your email address must be verified before you can use this endpoint.',
            self::AuthTwoFactorRequired => 'A two-factor authentication code is required.',
            self::AuthTwoFactorInvalid => 'The provided two-factor authentication code was invalid.',
            self::AuthStepUpRequired => 'This action requires you to confirm your password again.',
            self::AuthCsrfTokenMismatch => 'The CSRF token is missing or has expired.',
            self::AuthInvalidSignature => 'This link is invalid or has expired. Please request a new one.',
            self::ContextOrganisationRequired => 'An X-Organisation-Id header is required for this endpoint.',
            self::ContextOrganisationForbidden => 'You do not have an active membership in the requested organisation.',
            self::ContextBranchOutOfScope => 'The requested branch is not within your membership scope.',
            self::AuthzPermissionDenied => 'You do not have permission to perform this action.',
            self::RequestInvalid => 'The request could not be processed as sent.',
            self::RequestPreconditionRequired => 'This resource requires an If-Match header carrying the version you last read.',
            self::ResourceNotFound => 'The requested resource does not exist.',
            self::ResourceConflict => 'The requested change conflicts with the current state of the resource.',
            self::RateLimitExceeded => 'Too many requests. Please retry later.',
            self::ServerInternalError => 'An unexpected error occurred. The correlation identifier can be quoted to support.',
        };
    }

    /**
     * The code an unmapped HTTP error status is reported as. Used only as the
     * last step of exception rendering, so that no framework-generated error
     * can escape the envelope.
     */
    public static function forHttpStatus(int $status): self
    {
        return match ($status) {
            401 => self::AuthUnauthenticated,
            403 => self::AuthzPermissionDenied,
            404 => self::ResourceNotFound,
            409 => self::ResourceConflict,
            419 => self::AuthCsrfTokenMismatch,
            422 => self::ValidationFailed,
            428 => self::RequestPreconditionRequired,
            429 => self::RateLimitExceeded,
            default => $status >= 400 && $status < 500 ? self::RequestInvalid : self::ServerInternalError,
        };
    }
}
