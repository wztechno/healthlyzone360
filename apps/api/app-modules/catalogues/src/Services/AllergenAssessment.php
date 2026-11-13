<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;

/**
 * What staff are told about an item's allergen assessment, and the one way they
 * can answer it themselves.
 *
 * What counts as assessed is not decided here:
 * {@see CatalogueItem::scopeAllergensAssessed()} is the definition.
 */
final readonly class AllergenAssessment
{
    /**
     * A dish is cooked, so it ought to have a recipe. A product is resold and a
     * plan is not food, so neither is asked.
     *
     * @var list<CatalogueItemType>
     */
    private const array RECIPE_KINDS = [
        CatalogueItemType::Meal,
        CatalogueItemType::Sauce,
        CatalogueItemType::Dressing,
        CatalogueItemType::FrozenMeal,
    ];

    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private DerivedAllergenService $allergens,
    ) {}

    /** The attribute {@see prime()} leaves on a list's rows. */
    private const string PRIMED = 'allergens_assessed_primed';

    public function isAssessed(CatalogueItem $item): bool
    {
        $primed = $item->getAttributes()[self::PRIMED] ?? null;

        if (is_bool($primed)) {
            return $primed;
        }

        return CatalogueItem::withoutTenancy()->whereKey($item->getKey())->allergensAssessed()->exists();
    }

    /**
     * Answers {@see isAssessed()} for a whole list in one query, so a page of rows does
     * not ask once per row. The answer is stored as an original attribute, so it is never
     * dirty and a save never writes it.
     *
     * @param  Collection<int, CatalogueItem>  $items
     */
    public function prime(Collection $items): void
    {
        if ($items->isEmpty()) {
            return;
        }

        $assessed = CatalogueItem::withoutTenancy()
            ->whereKey($items->modelKeys())
            ->allergensAssessed()
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->flip();

        foreach ($items as $item) {
            $item->setRawAttributes([...$item->getAttributes(), self::PRIMED => $assessed->has((string) $item->getKey())], sync: true);
        }
    }

    /**
     * A dish on sale with no published recipe. It stays on sale: this is a warning
     * to staff, which is why it is a separate question from {@see isAssessed()}.
     */
    public function isOnSaleWithoutRecipe(CatalogueItem $item): bool
    {
        return $item->status === CatalogueItemStatus::Published
            && in_array($item->item_type, self::RECIPE_KINDS, true)
            && $this->allergens->publishedVersion($item) === null;
    }

    /**
     * Staff state the item contains none of the allergens.
     *
     * Only for an item with no other answer. Stamping one that is already assessed
     * would record a statement of absence over a recipe or ingredients that say
     * something else, so it is refused.
     *
     * No lock version, on purpose: this touches no field an editor holds, and
     * pressing it must not make somebody's open form stale.
     *
     * @throws ApiException
     */
    public function markNoneContained(CatalogueItem $item): CatalogueItem
    {
        if ($this->isAssessed($item)) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This catalogue item has already been assessed for allergens.',
                ['current_lock_version' => $item->lock_version],
            );
        }

        $userId = $this->context->userId();

        $item->forceFill([
            'allergens_assessed_at' => now(),
            'allergens_assessed_by' => $userId,
            'updated_by' => $userId,
        ])->save();

        $this->audit->record(
            'catalogue.item_allergens_assessed',
            actorUserId: $userId,
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: ['slug' => $item->slug],
        );

        return $item;
    }
}
