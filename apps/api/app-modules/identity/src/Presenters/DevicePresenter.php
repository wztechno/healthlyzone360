<?php

declare(strict_types=1);

namespace Healthy360\Identity\Presenters;

use Healthy360\Identity\Models\UserDevice;

/**
 * The wire shape of a registered device. Mirrors the Device schema in
 * openapi/healthy360.v1.yaml. token_reference is never exposed: it is an
 * internal handle on the credential, not something a client needs.
 */
final class DevicePresenter
{
    /**
     * @return array{
     *     id: string,
     *     device_name: string,
     *     platform: string,
     *     app_version: string|null,
     *     last_seen_at: string|null,
     *     created_at: string|null,
     *     is_current: bool
     * }
     */
    public function device(UserDevice $device, ?string $currentTokenReference = null): array
    {
        return [
            'id' => (string) $device->getKey(),
            'device_name' => $device->device_name,
            'platform' => $device->platform,
            'app_version' => $device->app_version,
            'last_seen_at' => $device->last_seen_at?->toIso8601String(),
            'created_at' => $device->created_at?->toIso8601String(),
            'is_current' => $currentTokenReference !== null
                && $device->token_reference === $currentTokenReference,
        ];
    }
}
