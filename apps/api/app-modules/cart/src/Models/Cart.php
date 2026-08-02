<?php

declare(strict_types=1);

namespace Healthy360\Cart\Models;

use Carbon\CarbonImmutable;
use Healthy360\Cart\Database\Factories\CartFactory;
use Healthy360\Cart\Enums\CartStatus;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A customer's open basket against one kitchen's channel.
 *
 * **Deliberately not `OrganisationScoped`**, for the reason `CustomerAccount`
 * is not: the tenancy trait applies a global scope keyed on the ambient
 * organisation, and the owner of a cart is a customer who holds no membership
 * in the kitchen they are buying from. A fail-closed organisation scope would
 * hide every basket from the person who filled it. The column is still here
 * and still means the seller — `CartService` filters on it explicitly, which
 * is what keeps one kitchen's baskets out of another's reach.
 *
 * Classified `Internal` throughout. Nothing here is a person's own detail —
 * the identifying data lives on the customer account this points at — but a
 * basket is nobody else's business either, and a consumer projection carries
 * item names rather than these columns.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $customer_account_id
 * @property string $sales_channel_id
 * @property string|null $branch_id
 * @property CartStatus $status
 * @property string $currency_code
 * @property CarbonImmutable $expires_at
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Collection<int, CartItem> $items
 * @property-read CustomerAccount|null $customerAccount
 * @property-read SalesChannel|null $salesChannel
 */
#[Classified(DataClassification::Internal, 'status', 'currency_code', 'expires_at')]
class Cart extends BaseModel
{
    /** @use HasFactory<CartFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => CartStatus::class,
            'expires_at' => 'immutable_datetime',
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return HasMany<CartItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(CartItem::class);
    }

    /**
     * @return BelongsTo<CustomerAccount, $this>
     */
    public function customerAccount(): BelongsTo
    {
        return $this->belongsTo(CustomerAccount::class);
    }

    /**
     * @return BelongsTo<SalesChannel, $this>
     */
    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class, 'sales_channel_id');
    }

    /**
     * @return BelongsTo<Organisation, $this>
     */
    public function organisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class);
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }

    public function isShoppable(): bool
    {
        return $this->status->isShoppable();
    }
}
