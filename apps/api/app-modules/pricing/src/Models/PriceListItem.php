<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Pricing\Database\Factories\PriceListItemFactory;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One price, for one pricing point, over one interval of time.
 *
 * The standing row is the one with `effective_to IS NULL`; everything else is
 * history, and history is closed rather than edited. Nothing in this module
 * updates an amount in place.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $price_list_id
 * @property string $catalogue_item_id
 * @property string|null $catalogue_item_variant_id
 * @property string|null $min_quantity
 * @property int|null $unit_amount_minor
 * @property PriceStatus $price_status
 * @property CarbonImmutable $effective_from
 * @property CarbonImmutable|null $effective_to
 * @property string|null $superseded_by_id
 * @property string|null $source_system
 * @property string|null $source_ref
 * @property CarbonImmutable|null $seeded_at
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Confidential, 'unit_amount_minor', 'min_quantity')]
class PriceListItem extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<PriceListItemFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'price_status' => PriceStatus::class,
            'effective_from' => 'immutable_date',
            'effective_to' => 'immutable_date',
            'seeded_at' => 'immutable_datetime',
            'unit_amount_minor' => 'integer',
        ];
    }

    /**
     * **The scope M1's leak sweep is built on.** Rows that are both standing
     * and confirmed — which is to say, the only rows that may ever reach a
     * customer.
     *
     * Written here, once, and pinned by a test that proves placeholder and
     * market-priced rows fall outside it, because the public projection that
     * will consume it does not exist yet. A denylist applied to a shape that
     * already contains the wrong rows is one refactor away from leaking; a
     * scope that never selects them cannot leak by omission.
     *
     * Deliberately silent about the *list*: whether the tariff is active,
     * within its own validity window and assigned to the channel in question
     * are three further questions, and the resolver asks them. A scope named
     * for two conditions that quietly applied five would be the kind of helper
     * nobody can reason about at the call site.
     *
     * @param  Builder<PriceListItem>  $query
     */
    #[Scope]
    protected function confirmedOpenRows(Builder $query): void
    {
        $query->whereNull('effective_to')->where('price_status', PriceStatus::Confirmed->value);
    }

    /**
     * The standing rows of a list, whatever they claim.
     *
     * @param  Builder<PriceListItem>  $query
     */
    #[Scope]
    protected function openRows(Builder $query): void
    {
        $query->whereNull('effective_to');
    }

    /**
     * Whether this row governed the given day.
     *
     * `[effective_from, effective_to)` — the end is exclusive, so a row closed
     * today and its replacement opened today do not both claim the day of the
     * change. See migration 000802 for why that is forced rather than chosen.
     */
    public function governs(CarbonImmutable $date): bool
    {
        if ($date->lessThan($this->effective_from)) {
            return false;
        }

        return $this->effective_to === null || $date->lessThan($this->effective_to);
    }

    /**
     * @return BelongsTo<PriceList, $this>
     */
    public function priceList(): BelongsTo
    {
        return $this->belongsTo(PriceList::class);
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function catalogueItem(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class);
    }

    /**
     * @return BelongsTo<CatalogueItemVariant, $this>
     */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(CatalogueItemVariant::class, 'catalogue_item_variant_id');
    }

    /**
     * @return BelongsTo<PriceListItem, $this>
     */
    public function supersededBy(): BelongsTo
    {
        return $this->belongsTo(self::class, 'superseded_by_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
