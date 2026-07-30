<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Middleware;

use Closure;
use Healthy360\Identity\Models\PersonalAccessToken;
use Healthy360\Identity\Services\DeviceRegistrar;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Keeps user_devices.last_seen_at current for bearer-authenticated traffic
 * (alias: device.touch).
 *
 * Runs after the response is produced and is throttled to one write per
 * device per interval, so device management stays useful without putting an
 * UPDATE on every request. First-party session requests carry a transient
 * token and are ignored.
 */
class TouchUserDevice
{
    public function __construct(private readonly DeviceRegistrar $devices) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $user = $request->user();
        $token = method_exists($user, 'currentAccessToken') ? $user->currentAccessToken() : null;

        if ($token instanceof PersonalAccessToken) {
            $this->devices->touch((string) $token->getKey());
        }

        return $response;
    }
}
