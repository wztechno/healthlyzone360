<?php

declare(strict_types=1);

namespace Healthy360\Production\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A step within a batch — open or done.
 *
 * **Nothing reads or writes this table.** There is no task UI, PROD1 does not add
 * one, and the batch lifecycle lives entirely on {@see ProductionOrder}. It is
 * kept rather than dropped because a kitchen's own prep checklist is the obvious
 * next thing to want and the table already models it.
 *
 * It gains tenancy here for a reason that has nothing to do with today's readers
 * and everything to do with tomorrow's: a tenant-owned table with no
 * `BelongsToOrganisation` fails **open**. The first query anybody writes against
 * it would be scoped by whatever they remembered rather than by the global scope,
 * and that is a leak nobody would review for because there is nothing to review.
 * Adding the trait before the first reader exists means the first reader inherits
 * the protection.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $production_order_id
 * @property string $name
 * @property string $status open | done
 * @property CarbonImmutable $created_at
 * @property CarbonImmutable $updated_at
 * @property-read ProductionOrder|null $productionOrder
 */
class ProductionTask extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * @return BelongsTo<ProductionOrder, $this>
     */
    public function productionOrder(): BelongsTo
    {
        return $this->belongsTo(ProductionOrder::class);
    }
}
