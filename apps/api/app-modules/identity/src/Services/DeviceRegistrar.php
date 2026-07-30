<?php

declare(strict_types=1);

namespace Healthy360\Identity\Services;

use App\Models\User;
use Healthy360\Identity\Models\PersonalAccessToken;
use Healthy360\Identity\Models\UserDevice;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\NewAccessToken;

/**
 * Owns the relationship between a native client's device record and the
 * Sanctum personal access token it authenticates with.
 *
 * Only the token id is ever persisted on the device row (token_reference) —
 * the plaintext token exists exactly once, in the issuing response.
 * Re-registering the same device name and platform rotates the token and
 * revokes the previous one, so a reinstall cannot leave an orphaned
 * credential behind.
 */
final class DeviceRegistrar
{
    /**
     * How long a "last seen" write is suppressed for. Bearer traffic is
     * chatty; a five-minute resolution is enough for device management and
     * keeps the write off the hot path.
     */
    private const int TOUCH_INTERVAL_SECONDS = 300;

    /**
     * @return array{device: UserDevice, token: NewAccessToken}
     */
    public function register(User $user, string $deviceName, string $platform, ?string $appVersion): array
    {
        return DB::transaction(function () use ($user, $deviceName, $platform, $appVersion): array {
            $device = UserDevice::query()
                ->where('user_id', $user->getKey())
                ->where('device_name', $deviceName)
                ->where('platform', $platform)
                ->first();

            if ($device !== null) {
                $this->deleteToken($device);
            }

            $token = $user->createToken($deviceName);

            $attributes = [
                'user_id' => $user->getKey(),
                'device_name' => $deviceName,
                'platform' => $platform,
                'app_version' => $appVersion,
                'token_reference' => (string) $token->accessToken->getKey(),
                'last_seen_at' => now(),
                'revoked_at' => null,
            ];

            if ($device === null) {
                $device = UserDevice::query()->create($attributes + ['created_by' => $user->getKey()]);
            } else {
                $device->forceFill($attributes)->save();
            }

            return ['device' => $device, 'token' => $token];
        });
    }

    /**
     * Revoke a device and destroy the credential it carries. Revoking the
     * device backing the current request's token is legitimate and
     * immediately invalidates that token.
     */
    public function revoke(UserDevice $device): void
    {
        DB::transaction(function () use ($device): void {
            $this->deleteToken($device);

            $device->forceFill(['revoked_at' => now()])->save();
        });
    }

    /**
     * Record that a bearer credential was used, at most once per interval.
     */
    public function touch(string $tokenReference): void
    {
        $fresh = Cache::add('h360:device-touch:'.$tokenReference, true, self::TOUCH_INTERVAL_SECONDS);

        if (! $fresh) {
            return;
        }

        UserDevice::query()
            ->where('token_reference', $tokenReference)
            ->whereNull('revoked_at')
            ->update(['last_seen_at' => now()]);
    }

    private function deleteToken(UserDevice $device): void
    {
        PersonalAccessToken::query()->whereKey($device->token_reference)->delete();
    }
}
