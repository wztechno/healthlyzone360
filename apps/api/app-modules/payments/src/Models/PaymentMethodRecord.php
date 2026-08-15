<?php

declare(strict_types=1);

namespace Healthy360\Payments\Models;

use Healthy360\Payments\Enums\PaymentMethodKind;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A stored payment instrument reference — never card PAN data.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $customer_account_id
 * @property PaymentMethodKind $kind
 * @property string|null $label
 * @property string|null $provider_ref
 */
class PaymentMethodRecord extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => PaymentMethodKind::class,
        ];
    }

    /**
     * @return HasMany<PaymentIntent, $this>
     */
    public function intents(): HasMany
    {
        return $this->hasMany(PaymentIntent::class);
    }
}
