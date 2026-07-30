<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Models;

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Factories\PermissionFactory;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * Platform-global permission definition (domain.action_scope format).
 *
 * @property string $id
 * @property string $code
 * @property string $domain
 * @property string $description
 * @property bool $is_assignable
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class Permission extends BaseModel
{
    /** @use HasFactory<PermissionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_assignable' => 'boolean',
        ];
    }
}
