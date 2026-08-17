<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One named person at a supplier — Samir who takes the vegetable order, not the
 * office line the supplier row itself carries (§3.2).
 *
 * Organisation-scoped in its own right rather than only through its supplier:
 * the contact editor reads these rows directly, and phase 2's dispatch
 * destination picker will read them directly again.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $supplier_id
 * @property string $name
 * @property string|null $role_title
 * @property string|null $email
 * @property string|null $phone
 * @property string|null $whatsapp_phone
 * @property bool $is_primary
 * @property int $display_order
 */
class SupplierContact extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'is_primary' => 'boolean',
            'display_order' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Supplier, $this>
     */
    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }
}
