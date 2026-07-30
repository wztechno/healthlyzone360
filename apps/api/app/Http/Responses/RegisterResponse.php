<?php

declare(strict_types=1);

namespace App\Http\Responses;

use App\Models\User;
use Healthy360\Identity\Services\UserContextHydrator;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\RegisterResponse as RegisterResponseContract;

/**
 * A created account. Returns the same `user` object /api/v1/me exposes, so a
 * client can render the "verify your email" state without a second call.
 */
class RegisterResponse implements RegisterResponseContract
{
    public function __construct(private readonly UserContextHydrator $hydrator) {}

    /**
     * @param  Request  $request
     */
    public function toResponse($request): JsonResponse
    {
        $user = $request->user();

        return ApiResponse::data(
            ['user' => $user instanceof User ? $this->hydrator->user($user) : null],
            status: 201,
        );
    }
}
