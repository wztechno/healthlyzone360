<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * One free change a customer may make to a dish. See the table's migration.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_item_id
 * @property string $kind `remove` or `choice`
 * @property string|null $group_en
 * @property string|null $group_ar
 * @property string $name_en
 * @property string $name_ar
 * @property int $display_order
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'kind', 'group_en', 'group_ar', 'name_en', 'name_ar')]
class CatalogueItemOption extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
