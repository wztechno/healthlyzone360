<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Identity\Http\Concerns\ResolvesAuthenticatedUser;
use Healthy360\Identity\Models\PersonalAccessToken;
use Healthy360\Identity\Models\UserDevice;
use Healthy360\Identity\Presenters\DevicePresenter;
use Healthy360\Identity\Services\DeviceRegistrar;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Device management for the authenticated person (plan §13).
 *
 * Every query is scoped to the caller's own rows, so another person's device
 * identifier is indistinguishable from one that does not exist: both are
 * resource.not_found.
 *
 * Revocation is step-up protected — it is how a stolen phone is cut off, so
 * a hijacked session must not be able to perform it, and it must not be
 * possible to lock someone out of their own account by revoking their
 * devices.
 */
final class DeviceController
{
    use ResolvesAuthenticatedUser;

    public function __construct(
        private readonly DevicePresenter $presenter,
        private readonly DeviceRegistrar $devices,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * Active devices, newest first. Revoked devices are history rather than
     * something a client can act on, so they are not listed.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $this->currentUser($request);
        $current = $this->currentTokenReference($request);

        $devices = UserDevice::query()
            ->where('user_id', $user->getKey())
            ->whereNull('revoked_at')
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (UserDevice $device): array => $this->presenter->device($device, $current))
            ->all();

        return ApiResponse::data($devices, ['count' => count($devices)]);
    }

    /**
     * Revoke a device and destroy its credential. Revoking the device backing
     * the current request is allowed and takes effect immediately.
     */
    public function destroy(Request $request, string $device): Response
    {
        $user = $this->currentUser($request);

        $record = UserDevice::query()
            ->where('user_id', $user->getKey())
            ->whereNull('revoked_at')
            ->whereKey($device)
            ->first();

        if (! $record instanceof UserDevice) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $this->devices->revoke($record);

        $this->audit->record('auth.device_revoked', (string) $user->getKey(), 'user_device', (string) $record->getKey(), [
            'device_platform' => $record->platform,
        ]);

        return ApiResponse::noContent();
    }

    private function currentTokenReference(Request $request): ?string
    {
        $user = $request->user();
        $token = method_exists($user, 'currentAccessToken') ? $user->currentAccessToken() : null;

        return $token instanceof PersonalAccessToken ? (string) $token->getKey() : null;
    }
}
