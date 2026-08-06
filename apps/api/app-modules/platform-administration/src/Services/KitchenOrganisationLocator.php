<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Services;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationType;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Builder;

/**
 * Turns a `{organisation}` path segment into a kitchen, or a 404.
 *
 * The twin of `B2bLocator`, and written the same way for the same three
 * reasons. Route-model binding is not used anywhere on this platform, because
 * a bound model arrives already resolved and the scoping question — *which*
 * organisations may this route see? — then has to be answered again in the
 * controller. A malformed identifier is substituted rather than queried, so
 * PostgreSQL never sees `uuid = 'nonsense'` and answers with a driver error
 * where a 404 belongs. And an organisation that exists but is not a kitchen
 * answers 404 rather than 403: the platform console is not the place to
 * confirm the existence of clinics.
 *
 * Slugs resolve as well as identifiers. An operator reading a support ticket
 * has the slug in front of them and not a UUID.
 */
final class KitchenOrganisationLocator
{
    public const string KITCHEN_TYPE = 'kitchen';

    /**
     * @throws ApiException
     */
    public function kitchen(string $identifier): Organisation
    {
        $needle = trim($identifier);

        $found = $this->kitchens()
            ->where(function (Builder $query) use ($needle): void {
                $query->where('slug', $needle);

                if (preg_match('/^[0-9a-f-]{36}$/i', $needle) === 1) {
                    $query->orWhere('id', $needle);
                }
            })
            ->first();

        if (! $found instanceof Organisation) {
            throw new ApiException(
                ErrorCode::ResourceNotFound,
                'No kitchen organisation with that identifier exists.',
            );
        }

        return $found;
    }

    /**
     * Every kitchen organisation, whatever its status.
     *
     * Unlike `MarketplaceKitchens::visible()` this deliberately does **not**
     * filter on `status`. The console's whole job is the suspended ones.
     *
     * @return Builder<Organisation>
     */
    public function kitchens(): Builder
    {
        return Organisation::query()
            ->with('type')
            ->whereIn(
                'organisation_type_id',
                OrganisationType::query()->where('code', self::KITCHEN_TYPE)->select('id'),
            );
    }
}
