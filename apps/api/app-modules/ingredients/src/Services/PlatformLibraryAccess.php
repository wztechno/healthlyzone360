<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\AccessControl\Http\Middleware\RequirePlatformContext;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Tenancy\TenantContext;

/**
 * One question, asked in one place: may the caller write the platform library?
 *
 * The rule used to be implied by `IngredientCatalogueService::assertWritable`,
 * which refused every row with a NULL `organisation_id` — a tenant *and* the
 * platform operator alike. That made the shared library permanently read-only:
 * the 306 seeded rows had no writer anywhere in the product, and the fork
 * endpoint the guard's comment pointed at as the way out is a later slice.
 *
 * The boundary the architecture actually wants is the one
 * {@see RequirePlatformContext} states: a tenant may write only its own rows,
 * and the platform library belongs to the organisation whose *type* is
 * `platform_operator`. Type, not permission — a tenant that somehow held the
 * permission still is not the platform.
 *
 * Memoised because a request presents a *page* of ingredients and the answer
 * is a property of the caller, not of the row — one organisation lookup, not
 * twenty-five.
 *
 * **Keyed by organisation, not cached as a single flag.** The instance is
 * scoped to the request, but a request is not the same thing as one tenant
 * context: the workbook importers restore a different context per affected
 * kitchen inside a single call, and a test method commonly acts as a tenant
 * and then as the operator against the same container. A bare boolean would
 * answer the first caller's question for the second one, which on a write
 * guard is the wrong kind of wrong.
 */
final class PlatformLibraryAccess
{
    /** @var array<string, bool> organisation id → is it the platform operator */
    private array $resolved = [];

    public function __construct(private readonly TenantContext $context) {}

    /**
     * Whether the caller's selected organisation is the platform operator, and
     * may therefore write rows the whole estate reads.
     */
    public function mayWritePlatformRows(): bool
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            return false;
        }

        if (array_key_exists($organisationId, $this->resolved)) {
            return $this->resolved[$organisationId];
        }

        $organisation = Organisation::query()->with('type')->find($organisationId);

        return $this->resolved[$organisationId] =
            $organisation?->type?->code === RequirePlatformContext::PLATFORM_OPERATOR_TYPE;
    }
}
