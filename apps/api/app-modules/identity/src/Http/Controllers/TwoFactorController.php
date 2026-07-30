<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Controllers;

use App\Models\User;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Identity\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Actions\ConfirmTwoFactorAuthentication;
use Laravel\Fortify\Actions\DisableTwoFactorAuthentication;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\Actions\GenerateNewRecoveryCodes;
use Laravel\Fortify\Fortify;

/**
 * TOTP two-factor enrolment and management (plan §13).
 *
 * The work is done by Fortify's actions; this controller exists because
 * Fortify's stock controllers answer the QR code, secret key and recovery
 * codes as bare JSON, and the Healthy360 contract admits no non-envelope
 * body (docs/api/conventions.md).
 *
 * Enrolment is two-step (`confirm => true` in config/fortify.php): enabling
 * writes a secret and recovery codes but does not arm two-factor
 * authentication, so a person who cannot complete their authenticator setup
 * is never locked out. Disabling is step-up protected.
 */
final class TwoFactorController
{
    use ResolvesAuthenticatedUser;

    public function __construct(private readonly AuditRecorder $audit) {}

    /**
     * Begin enrolment: generate a secret and recovery codes.
     */
    public function store(Request $request, EnableTwoFactorAuthentication $enable): JsonResponse
    {
        $user = $this->currentUser($request);

        $enable($user, $request->boolean('force'));

        $this->audit->record('auth.two_factor_enabled', (string) $user->getKey());

        return ApiResponse::data($this->state($user->refresh()), status: 201);
    }

    /**
     * Complete enrolment by proving the authenticator is configured.
     */
    public function confirm(Request $request, ConfirmTwoFactorAuthentication $confirm): JsonResponse
    {
        $user = $this->currentUser($request);

        $confirm($user, (string) $request->string('code'));

        $this->audit->record('auth.two_factor_confirmed', (string) $user->getKey());

        return ApiResponse::data($this->state($user->refresh()));
    }

    /**
     * Step-up protected: turning two-factor off is exactly what an attacker
     * holding a hijacked session would try first.
     */
    public function destroy(Request $request, DisableTwoFactorAuthentication $disable): JsonResponse
    {
        $user = $this->currentUser($request);

        $disable($user);

        $this->audit->record('auth.two_factor_disabled', (string) $user->getKey());

        return ApiResponse::data($this->state($user->refresh()));
    }

    /**
     * The provisioning QR code for the pending or active secret.
     *
     * @throws ApiException
     */
    public function qrCode(Request $request): JsonResponse
    {
        $user = $this->enrolled($request);

        return ApiResponse::data([
            'svg' => $user->twoFactorQrCodeSvg(),
            'url' => $user->twoFactorQrCodeUrl(),
        ]);
    }

    /**
     * The shared secret, for authenticator apps that cannot scan a code.
     *
     * @throws ApiException
     */
    public function secretKey(Request $request): JsonResponse
    {
        $user = $this->enrolled($request);

        return ApiResponse::data([
            'secret_key' => Fortify::currentEncrypter()->decrypt((string) $user->two_factor_secret),
        ]);
    }

    /**
     * @throws ApiException
     */
    public function recoveryCodes(Request $request): JsonResponse
    {
        $user = $this->enrolled($request);

        return ApiResponse::data(['recovery_codes' => $this->codesFor($user)]);
    }

    /**
     * @throws ApiException
     */
    public function regenerateRecoveryCodes(Request $request, GenerateNewRecoveryCodes $generate): JsonResponse
    {
        $user = $this->enrolled($request);

        $generate($user);

        $this->audit->record('auth.two_factor_recovery_codes_regenerated', (string) $user->getKey());

        return ApiResponse::data(['recovery_codes' => $this->codesFor($user->refresh())], status: 201);
    }

    /**
     * A user part-way through or finished with enrolment. Anything else is a
     * 404: there is no secret to describe.
     *
     * @throws ApiException
     */
    private function enrolled(Request $request): User
    {
        $user = $this->currentUser($request);

        if (! is_string($user->two_factor_secret)) {
            throw new ApiException(
                ErrorCode::ResourceNotFound,
                'Two-factor authentication has not been enabled for this account.',
            );
        }

        return $user;
    }

    /**
     * @return list<string>
     */
    private function codesFor(User $user): array
    {
        if (! is_string($user->two_factor_recovery_codes)) {
            return [];
        }

        /** @var list<string> */
        return array_values($user->recoveryCodes());
    }

    /**
     * @return array{enabled: bool, confirmed: bool, confirmed_at: string|null}
     */
    private function state(User $user): array
    {
        return [
            'enabled' => is_string($user->two_factor_secret),
            'confirmed' => $user->hasEnabledTwoFactorAuthentication(),
            'confirmed_at' => $user->two_factor_confirmed_at?->toIso8601String(),
        ];
    }
}
