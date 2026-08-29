<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\ProductionMode;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Healthy360\Inventory\Observers\DerivedStockObserver;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Keeps a kitchen's stock items in step with what it actually handles (INV2.0).
 *
 * A stock item used to be hand-declared, which meant a kitchen could receive
 * flour it had never listed as an ingredient, sell a product that deducted
 * nothing, and hold a shelf no recipe could ever reach. Stock is now *derived*
 * from the two tables that already say what a kitchen deals in:
 *
 * 1. **Every ingredient in the library** — the platform's shared rows and the
 *    kitchen's own. A kitchen can receive anything it can cook with, without
 *    declaring the same thing twice.
 * 2. **Every product it buys in to resell** — `production_mode` is `supplier` or
 *    `both`. A product it *makes* (`production`) is not stock: the ingredients it
 *    is made from already are.
 *
 * ## Every stock item keeps an ingredient, resold products included
 *
 * `ingredient_stock_costs` is keyed by `(organisation, ingredient)` — the moving
 * average, COGS on a sale and the monthly report all read it. A product-backed
 * shelf with no ingredient would therefore be a shelf with no valuation, so this
 * service anchors one: a product that already names the ingredient it is
 * ({@see CatalogueItem::$ingredient_id}, the schema's own "a resold raw good
 * points at the ingredient it is") uses that; one that does not gets an org-owned
 * ingredient minted from its own name and purchasing unit. That ingredient is an
 * implementation detail — nobody manages it, and the stock screen shows the
 * product.
 *
 * The same anchoring rescues stock items that pre-date derivation: a row with
 * neither link is adopted rather than orphaned, because it may already hold a
 * real count a kitchen has been adjusting for months.
 *
 * ## Converging, not accumulating
 *
 * Every write is `firstOrCreate`-shaped against the partial unique indexes added
 * with `catalogue_item_id`, so running this twice — or racing two runs — cannot
 * split one ingredient across two shelves. Names and units are refreshed on every
 * pass, because they are derived and must track their source; a `code` is minted
 * once and then left alone, the same discipline a slug gets, because it is what a
 * person recognises the row by.
 *
 * ## The observer only covers what a kitchen does
 *
 * {@see DerivedStockObserver} calls the two
 * per-record entry points when a kitchen creates an ingredient or a product.
 * Growth of the *platform library* is deliberately not covered: one shared
 * ingredient becomes a row in every kitchen, and an import of two hundred would
 * become twelve hundred inserts fired one model event at a time. That is the
 * backfill command's job (`inventory:derive-stock-items`), which the seeder runs.
 *
 * Minting an anchor ingredient is the one place that has to switch the observer
 * off ({@see DerivedStockObserver::withoutDerivation()}): left on, the mint gives
 * the anchor a plain ingredient-backed shelf, and that brand-new empty row is
 * then in the way of the one being written — the resold product's shelf, or the
 * pre-derivation row being adopted, both of which carry the count that matters.
 */
final readonly class StockItemDerivationService
{
    /** The unit a resold product falls back to when it names neither a purchasing nor a usage unit. */
    private const string FALLBACK_UNIT_CODE = 'piece';

    /**
     * The production modes that mean "this arrives from a supplier". `both` is
     * included on purpose: a kitchen that sometimes makes a thing and sometimes
     * buys it in still receives the bought ones onto a shelf.
     *
     * @var list<string>
     */
    private const array RESOLD_MODES = [ProductionMode::Supplier->value, ProductionMode::Both->value];

    /**
     * The sellable kinds a supplier-mode row of which is a shelf. A sauce or
     * dressing a kitchen resells behaves exactly like a resold product; the
     * usual production-mode ones are not stock — their ingredients are.
     *
     * @var list<string>
     */
    private const array RESOLD_ITEM_TYPES = ['product', 'sauce', 'dressing'];

    /**
     * Bring one organisation's stock items in line with its ingredients and its
     * resold products.
     *
     * @return array{ingredients: int, products: int, adopted: int} rows created by each pass
     */
    public function syncOrganisation(string $organisationId): array
    {
        return DB::transaction(function () use ($organisationId): array {
            $adopted = $this->adoptUnlinkedStockItems($organisationId);

            $products = 0;

            $this->resoldProducts($organisationId)->each(function (CatalogueItem $product) use ($organisationId, &$products): void {
                if ($this->ensureProductStock($organisationId, $product)) {
                    $products++;
                }
            });

            $ingredients = 0;

            $this->visibleIngredients($organisationId)
                ->where('status', '!=', IngredientStatus::Archived)
                ->orderBy('id')
                ->chunkById(200, function (iterable $chunk) use ($organisationId, &$ingredients): void {
                    foreach ($chunk as $ingredient) {
                        if ($this->ensureIngredientStock($organisationId, $ingredient)) {
                            $ingredients++;
                        }
                    }
                });

            return ['ingredients' => $ingredients, 'products' => $products, 'adopted' => $adopted];
        });
    }

    /**
     * A kitchen declared an ingredient of its own: give it a shelf at once, so it
     * can be received against without waiting for a backfill.
     *
     * Platform-library rows are ignored here on purpose — see the class docblock.
     */
    public function syncIngredient(Ingredient $ingredient): void
    {
        $organisationId = $ingredient->organisation_id;

        if ($organisationId === null || $ingredient->status === IngredientStatus::Archived) {
            return;
        }

        $this->ensureIngredientStock((string) $organisationId, $ingredient);
    }

    /** A kitchen added a product: give it a shelf if it is one it buys in. */
    public function syncProduct(CatalogueItem $product): void
    {
        if (! $this->isResold($product)) {
            return;
        }

        $this->ensureProductStock((string) $product->organisation_id, $product);
    }

    /** @return bool whether a row was created */
    private function ensureIngredientStock(string $organisationId, Ingredient $ingredient): bool
    {
        $existing = $this->stockItemFor($organisationId, 'ingredient_id', (string) $ingredient->getKey());
        $unitId = (string) $ingredient->default_unit_id;

        if ($existing instanceof StockItem) {
            // Never rename a shelf that a product owns: a resold product's own
            // name is what the kitchen put on it, and the anchor ingredient
            // behind it is an implementation detail with a borrowed name.
            if ($existing->catalogue_item_id === null) {
                $this->refresh($existing, $ingredient->name_en, $unitId);
            }

            return false;
        }

        $this->create($organisationId, $ingredient->slug, $ingredient->name_en, $unitId, (string) $ingredient->getKey(), null);

        return true;
    }

    /** @return bool whether a row was created */
    private function ensureProductStock(string $organisationId, CatalogueItem $product): bool
    {
        $unitId = $this->unitIdForProduct($product);

        $existing = $this->stockItemFor($organisationId, 'catalogue_item_id', (string) $product->getKey());

        if ($existing instanceof StockItem) {
            $this->refresh($existing, $product->name_en, $unitId);

            return false;
        }

        $ingredientId = $product->ingredient_id !== null
            ? (string) $product->ingredient_id
            : (string) $this->mintIngredient($organisationId, $product->name_en, $unitId)->getKey();

        // A product whose ingredient already has a shelf becomes that shelf
        // rather than a second one: one physical thing, one count. This is also
        // the branch that catches the anchor minted a line above, whose own
        // observer already gave it an ingredient-backed row.
        $anchored = $this->stockItemFor($organisationId, 'ingredient_id', $ingredientId);

        if ($anchored instanceof StockItem) {
            $anchored->catalogue_item_id = (string) $product->getKey();
            $this->refresh($anchored, $product->name_en, $unitId);

            return false;
        }

        $this->create($organisationId, $product->slug, $product->name_en, $unitId, $ingredientId, (string) $product->getKey());

        return true;
    }

    /**
     * Give every stock item that pre-dates derivation an ingredient to cost
     * itself by, so it lands in the ingredients book rather than nowhere.
     *
     * Matched by slug first: a hand-made "Basmati rice" and a library ingredient
     * of the same name are the same thing, and linking beats minting a duplicate.
     */
    private function adoptUnlinkedStockItems(string $organisationId): int
    {
        $orphans = StockItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereNull('ingredient_id')
            ->whereNull('catalogue_item_id')
            ->orderBy('code')
            ->get();

        $adopted = 0;

        foreach ($orphans as $orphan) {
            $ingredient = $this->visibleIngredients($organisationId)
                ->where('slug', Str::slug($orphan->name_en))
                ->first()
                ?? $this->mintIngredient($organisationId, $orphan->name_en, $this->unitIdForCode($orphan->unit_code));

            // Another shelf may already hold this ingredient — the unique index
            // would refuse the link, and the orphan is the duplicate.
            if ($this->stockItemFor($organisationId, 'ingredient_id', (string) $ingredient->getKey()) instanceof StockItem) {
                continue;
            }

            $orphan->ingredient_id = (string) $ingredient->getKey();
            $orphan->save();
            $adopted++;
        }

        return $adopted;
    }

    private function stockItemFor(string $organisationId, string $column, string $value): ?StockItem
    {
        return StockItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->where($column, $value)
            ->first();
    }

    /**
     * The ingredients an organisation can see: its own, plus the platform library
     * every tenant reads and none of them writes.
     *
     * @return Builder<Ingredient>
     */
    private function visibleIngredients(string $organisationId): Builder
    {
        return Ingredient::withoutTenancy()
            ->where(static function (Builder $query) use ($organisationId): void {
                $query->where('organisation_id', $organisationId)->orWhereNull('organisation_id');
            });
    }

    /**
     * @return Collection<int, CatalogueItem>
     */
    private function resoldProducts(string $organisationId)
    {
        return CatalogueItem::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('item_type', self::RESOLD_ITEM_TYPES)
            ->whereIn('production_mode', self::RESOLD_MODES)
            ->where('status', '!=', CatalogueItemStatus::Retired)
            ->orderBy('slug')
            ->get();
    }

    private function isResold(CatalogueItem $product): bool
    {
        return in_array($product->item_type->value, self::RESOLD_ITEM_TYPES, true)
            && $product->production_mode !== null
            && in_array($product->production_mode->value, self::RESOLD_MODES, true)
            && $product->status !== CatalogueItemStatus::Retired;
    }

    /**
     * An org-owned ingredient standing behind a shelf that has no catalogue one —
     * the cost anchor, never surfaced as an ingredient a kitchen manages.
     */
    private function mintIngredient(string $organisationId, string $nameEn, string $unitId): Ingredient
    {
        return DerivedStockObserver::withoutDerivation(function () use ($organisationId, $nameEn, $unitId): Ingredient {
            $ingredient = new Ingredient;
            $ingredient->organisation_id = $organisationId;
            $ingredient->slug = $this->uniqueIngredientSlug($organisationId, Str::slug($nameEn));
            $ingredient->name_en = $nameEn;
            // No translation to offer and none to invent: the English name is
            // what the source row carries, and a blank Arabic name would fail
            // NOT NULL.
            $ingredient->name_ar = $nameEn;
            $ingredient->default_unit_id = $unitId;
            $ingredient->save();

            return $ingredient;
        });
    }

    private function create(
        string $organisationId,
        string $slug,
        string $nameEn,
        string $unitId,
        string $ingredientId,
        ?string $catalogueItemId,
    ): void {
        $item = new StockItem;
        $item->organisation_id = $organisationId;
        $item->code = $this->uniqueCode($organisationId, $slug);
        $item->name_en = $nameEn;
        $item->unit_code = $this->unitCodeForId($unitId);
        $item->unit_id = $unitId;
        $item->ingredient_id = $ingredientId;
        $item->catalogue_item_id = $catalogueItemId;
        $item->save();
    }

    /**
     * Refresh what is safe to refresh. `code` is identity and is left alone; the name tracks its
     * source; the **unit only moves while nothing has ever been counted in it**.
     *
     * That last rule is not caution, it is arithmetic. A shelf holding `40` with a `unit_code` of
     * `kg` does not become forty *grams* because the ingredient master happens to measure itself in
     * grams — the number on the shelf was written by somebody counting kilograms, and re-labelling
     * it silently divides a real quantity by a thousand. Seeded stock hit exactly this: three of
     * four demo shelves were re-denominated by the first backfill.
     *
     * A shelf nobody has ever counted has no quantity to misread, so correcting it there is free.
     */
    private function refresh(StockItem $item, string $nameEn, string $unitId): void
    {
        $item->name_en = $nameEn;

        if (! $this->hasBeenCounted($item)) {
            $item->unit_code = $this->unitCodeForId($unitId);
            $item->unit_id = $unitId;
        }

        $item->save();
    }

    /** A level row or a movement — either means a number on this shelf means something. */
    private function hasBeenCounted(StockItem $item): bool
    {
        return StockLevel::withoutTenancy()->where('stock_item_id', $item->getKey())->exists()
            || StockMovement::withoutTenancy()->where('stock_item_id', $item->getKey())->exists();
    }

    /**
     * A resold product measures itself in what it is bought in, falling back to
     * how it is used and then to a countable piece — a bottle of oil is bought by
     * the bottle, not by the litre a recipe would divide.
     */
    private function unitIdForProduct(CatalogueItem $product): string
    {
        $unitId = $product->purchasing_unit_id ?? $product->usage_unit_id;

        return $unitId !== null ? (string) $unitId : $this->unitIdForCode(self::FALLBACK_UNIT_CODE);
    }

    /**
     * A raw lookup rather than a model import, matching the existing stock-item
     * write path: Inventory declares no dependency on ReferenceData, and the
     * foreign key is enough to make the row real.
     */
    private function unitIdForCode(string $unitCode): string
    {
        $unitId = DB::table('measurement_units')->where('code', $unitCode)->value('id')
            ?? DB::table('measurement_units')->where('code', self::FALLBACK_UNIT_CODE)->value('id')
            ?? DB::table('measurement_units')->orderBy('code')->value('id');

        return (string) $unitId;
    }

    private function unitCodeForId(string $unitId): string
    {
        return (string) (DB::table('measurement_units')->where('id', $unitId)->value('code') ?? self::FALLBACK_UNIT_CODE);
    }

    /** Suffixed `-2`, `-3`… until it clears `(organisation_id, code)`. */
    private function uniqueCode(string $organisationId, string $base): string
    {
        $base = Str::limit(Str::slug($base), 60, '');

        if ($base === '') {
            $base = 'stock-item';
        }

        $code = $base;
        $suffix = 2;

        while (StockItem::withoutTenancy()->where('organisation_id', $organisationId)->where('code', $code)->exists()) {
            $code = $base.'-'.$suffix;
            $suffix++;
        }

        return $code;
    }

    /** The same discipline for a minted ingredient's slug, against `(organisation_id, slug)`. */
    private function uniqueIngredientSlug(string $organisationId, string $base): string
    {
        $base = Str::limit($base, 110, '');

        if ($base === '') {
            $base = 'stock-ingredient';
        }

        $slug = $base;
        $suffix = 2;

        while (Ingredient::withoutTenancy()->where('organisation_id', $organisationId)->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$suffix;
            $suffix++;
        }

        return $slug;
    }
}
