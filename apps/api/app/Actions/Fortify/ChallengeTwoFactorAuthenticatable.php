<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Models\User;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Actions\RedirectIfTwoFactorAuthenticatable;
use Laravel\Fortify\Events\TwoFactorAuthenticationChallenged;

/**
 * The two-factor stage of the login pipeline, rewritten for the JSON API.
 *
 * Fortify's stock action answers `{"two_factor": true}` and reports bad
 * credentials as a field-level validation error. The Healthy360 contract is
 * an envelope carrying `two_factor_required`, and a distinct
 * auth.invalid_credentials code that clients can branch on without parsing
 * validation details (docs/api/conventions.md).
 */
class ChallengeTwoFactorAuthenticatable extends RedirectIfTwoFactorAuthenticatable
{
    /**
     * @param  Request  $request
     * @param  User  $user
     */
    protected function twoFactorChallengeResponse($request, $user): JsonResponse
    {
        $request->session()->put([
            'login.id' => $user->getKey(),
            'login.remember' => $request->boolean('remember'),
        ]);

        TwoFactorAuthenticationChallenged::dispatch($user);

        return ApiResponse::data(['two_factor_required' => true]);
    }

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
