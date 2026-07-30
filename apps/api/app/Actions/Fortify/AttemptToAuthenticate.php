<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Laravel\Fortify\Actions\AttemptToAuthenticate as FortifyAttemptToAuthenticate;

/**
 * The credential stage of the login pipeline.
 *
 * Identical to Fortify's, except that a rejected attempt raises
 * auth.invalid_credentials instead of a validation error on the email field.
 * Clients branch on the code, never on a field-level message.
 *
 * The failed attempt is still counted against the login rate limiter, so
 * EnsureLoginIsNotThrottled locks the email and IP pair out after five
 * failures and raises Illuminate\Auth\Events\Lockout for the audit trail.
 */
class AttemptToAuthenticate extends FortifyAttemptToAuthenticate
{
    /**
     * @param  Request  $request
     *
     * @throws ApiException
     */
    protected function throwFailedAuthenticationException($request): never
    {
        $this->limiter->increment($request);

        throw new ApiException(ErrorCode::AuthInvalidCredentials);
    }
}
