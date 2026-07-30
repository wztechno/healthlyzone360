<?php

declare(strict_types=1);

namespace Healthy360\Identity\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Concerns\HasUuidV7Key;
use Laravel\Sanctum\PersonalAccessToken as SanctumPersonalAccessToken;

/**
 * Sanctum's access token with the platform identifier strategy applied
 * (plan §8): UUIDv7 primary keys everywhere, no auto-incrementing ids.
 *
 * Sanctum composes the plaintext token as "{id}|{secret}" and looks the row
 * up by that id, so a string key is supported natively.
 *
 * @property string $id
 * @property string $tokenable_id
 * @property string $name
 * @property string $token
 * @property CarbonImmutable|null $last_used_at
 * @property CarbonImmutable|null $expires_at
 */
class PersonalAccessToken extends SanctumPersonalAccessToken
{
    use HasUuidV7Key;
}
