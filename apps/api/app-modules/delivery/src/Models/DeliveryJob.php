<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;

/**
 * One delivery of one order (F1).
 *
 * **Organisation-scoped, and the scope fails closed.** `OrganisationScope`
 * throws when no organisation is published rather than returning nothing, so
 * every route that reads this table must carry `org.context` — including the
 * driver's own run sheet, whose narrowing is `driver_user_id` on top of the
 * tenant rather than instead of it.
 *
 * **Two status columns, deliberately.** `status` is where the job is for
 * dispatch; `tracking_status` is what the customer would be told. "Assigned
 * but not yet collected" and "collected" are one dispatch state and two
 * different messages, and folding them into one column would mean choosing
 * which of those two audiences to serve badly.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $order_id
 * @property string|null $branch_id
 * @property string|null $driver_user_id
 * @property string $status
 * @property string $tracking_status
 * @property string|null $proof_of_delivery_notes
 * @property CarbonImmutable|null $assigned_at
 * @property CarbonImmutable|null $delivered_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class DeliveryJob extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'assigned_at' => 'immutable_datetime',
            'delivered_at' => 'immutable_datetime',
        ];
    }
}
