<?php

declare(strict_types=1);

namespace Healthy360\KitchenDisplay\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string $source_type the kind of work the ticket stands in for (e.g. an order)
 * @property string $source_id the id of that source record
 * @property string $station the station the ticket is routed to (default 'main')
 * @property string $status one of 'new', 'preparing', 'ready', 'bumped'
 * @property string $label human-facing summary shown on the board
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class KitchenDisplayTicket extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;
}
