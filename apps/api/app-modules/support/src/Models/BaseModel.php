<?php

declare(strict_types=1);

namespace Healthy360\Support\Models;

use Healthy360\Support\Concerns\HasUuidV7Key;
use Illuminate\Database\Eloquent\Model;

/**
 * Base model for Healthy360 domain models with UUIDv7 primary keys.
 *
 * Conventions: strict types, guarded mass assignment is relaxed because all
 * writes flow through module services and validated request data (never raw
 * request arrays), and dates are immutable application-wide (see
 * AppServiceProvider::configureDefaults()).
 */
abstract class BaseModel extends Model
{
    use HasUuidV7Key;

    /**
     * The attributes that aren't mass assignable.
     *
     * @var array<string>
     */
    protected $guarded = [];
}
