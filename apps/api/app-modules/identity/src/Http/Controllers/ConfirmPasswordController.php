<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Identity\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\Identity\Services\StepUpGuard;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Actions\ConfirmPassword;

/**
 * Step-up authentication (plan §13): recent password confirmation for
 * sensitive actions.
 *
 * Deliberately not Fortify's ConfirmablePasswordController: that one writes
 * the confirmation into the session unconditionally, so it cannot serve a
 * bearer-token client — and revoking a lost phone is exactly the action a
 * bearer client needs to step up for. StepUpGuard binds the confirmation to
 * the credential that performed it instead.
 *
 * Guarded endpoints: DELETE /api/v1/me/devices/{device} and
 * DELETE /api/v1/auth/two-factor-authentication.
 */
final class ConfirmPasswordController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly StatefulGuard $guard,
        private readonly ConfirmPassword $confirmPassword,
        private readonly StepUpGuard $stepUp,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * Whether the caller may currently perform a step-up protected action.
     */
    public function show(Request $request): JsonResponse
    {
        $this->currentUser($request);

        return ApiResponse::data([
            'confirmed' => $this->stepUp->confirmed($request),
            'timeout_seconds' => $this->stepUp->timeoutSeconds(),
        ]);
    }

    /**
     * @throws ApiException
     */
    public function store(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $password = $request->input('password');

        $confirmed = is_string($password)
            && ($this->confirmPassword)($this->guard, $user, $password);

        if (! $confirmed) {
            $this->audit->record('auth.step_up_failed', (string) $user->getKey());

            throw new ApiException(ErrorCode::AuthInvalidCredentials, details: ['field' => 'password']);
        }

        $this->stepUp->confirm($request);

        $this->audit->record('auth.step_up_confirmed', (string) $user->getKey());

        return ApiResponse::data([
            'confirmed' => true,
            'timeout_seconds' => $this->stepUp->timeoutSeconds(),
        ]);
    }
}
