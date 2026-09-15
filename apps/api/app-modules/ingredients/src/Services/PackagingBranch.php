<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Services;

use Healthy360\Ingredients\Models\IngredientCategory;

/**
 * The taxonomy branch that holds bags, boxes, lids, cutlery and labels.
 *
 * Packaging lives in `ingredients` because a recipe has to be able to cost the box its meal ships
 * in, and a cost line needs a record to point at. It is not a *raw material* though, so every
 * surface that means "food" excludes this branch and the one surface that means "packaging" asks
 * for it by name.
 *
 * **One place that knows the code, and one place that resolves it.** The day the string is
 * mistyped in one of six call sites, the ingredient list silently grows thirty-three rows of
 * cutlery and nothing fails — which is exactly what happened once already and is what got the
 * family moved to a table of its own. The client contract states the same rule from its side
 * (`PACKAGING_CATEGORY_CODE` in `kitchen-admin.ts`); this is its server half.
 *
 * ## Resolved once per request, and never cached across them
 *
 * The branch is six rows that change roughly never, so re-reading them per request would be
 * wasteful — but caching them in the container across requests would outlive a taxonomy edit and
 * hand a stale id to a filter. Memoised on the instance, which the container gives one of per
 * request, is the balance the rest of this module strikes.
 *
 * ## An empty branch is not an empty filter
 *
 * {@see self::categoryIds()} can legitimately return `[]` — a fresh database before the seeder
 * runs, or an installation that has never carried packaging. Callers must treat that as "nothing
 * to exclude" for the food case and "nothing to show" for the packaging case, never as "no
 * filter". Getting that backwards is the original bug, and {@see self::isSeeded()} exists so a
 * caller can tell the two apart deliberately rather than by accident.
 */
final class PackagingBranch
{
    /** The top-level node. Its children are matched by prefix, as the converter emits them. */
    public const string CODE = 'packaging-disposables';

    /** @var list<string>|null */
    private ?array $ids = null;

    /**
     * Every category id in the branch — the root and its children.
     *
     * Both levels, because a row may be filed at either: the workbook's rows carry a leaf
     * (`packaging-disposables-bags`), and the two a kitchen typed by hand sit at the root.
     *
     * @return list<string>
     */
    public function categoryIds(): array
    {
        if ($this->ids !== null) {
            return $this->ids;
        }

        /** @var list<string> $ids */
        $ids = IngredientCategory::withoutTenancy()
            ->where('code', 'like', self::CODE.'%')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all();

        return $this->ids = $ids;
    }

    /** Whether the branch exists at all. `false` on a database whose taxonomy has never been seeded. */
    public function isSeeded(): bool
    {
        return $this->categoryIds() !== [];
    }
}
