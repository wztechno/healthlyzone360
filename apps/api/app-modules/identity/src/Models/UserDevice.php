<?php

declare(strict_types=1);

namespace Healthy360\Identity\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Identity\Database\Factories\UserDeviceFactory;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A registered device holding a Sanctum token reference — never raw tokens.
 *
 * @property string $id
 * @property string $user_id
 * @property string $device_name
 * @property string $platform ios | android | web
 * @property string|null $app_version
 * @property string $token_reference
 * @property CarbonImmutable|null $last_seen_at
 * @property CarbonImmutable|null $revoked_at
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class UserDevice extends BaseModel
{
    /** @use HasFactory<UserDeviceFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }
}
