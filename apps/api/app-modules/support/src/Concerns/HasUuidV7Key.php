<?php

declare(strict_types=1);

namespace Healthy360\Support\Concerns;

use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Database\Eloquent\Concerns\HasUuids;

/**
 * Gives a model an application-generated UUIDv7 primary key.
 *
 * Reuses Laravel's unique-ID plumbing (string key type, non-incrementing,
 * route-binding validation) while routing generation through the central
 * Healthy360 identifier service.
 */
trait HasUuidV7Key
{
    use HasUuids;

    /**
     * Generate a new unique key for the model.
     */
    public function newUniqueId(): string
    {
        return app(IdentifierService::class)->generate();
    }
}
