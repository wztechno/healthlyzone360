<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Observers;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Inventory\Services\StockItemDerivationService;
use Illuminate\Database\Eloquent\Model;

/**
 * Keeps derived stock true as a kitchen declares things (INV2.0).
 *
 * A stock item is derived from an ingredient or a bought-in product, so the
 * moment either appears the shelf should exist — a chef who adds an ingredient
 * and immediately posts a delivery note against it should not have to wait for a
 * nightly backfill to find it in the picker.
 *
 * `created` only. A rename flows to the shelf on the next full sync rather than
 * on every keystroke-sized update, and an archive deliberately leaves the shelf
 * standing: the count on it is real, and a stock item that vanished when somebody
 * tidied the ingredient master would take a branch's quantity with it.
 */
final class DerivedStockObserver
{
    /**
     * Set while derivation is minting an anchor ingredient of its own.
     *
     * Without it the mint re-enters here and gives the anchor an
     * ingredient-backed shelf of its own, which is then in the way of the row
     * derivation was about to write — a resold product's shelf, or a pre-existing
     * one being adopted, both of which lose to a brand-new empty duplicate. The
     * flag is narrow on purpose: it covers one `save()` inside this service, not
     * a whole request, so nothing a caller does can leave derivation switched off.
     */
    private static bool $suspended = false;

    public function __construct(private readonly StockItemDerivationService $derivation) {}

    /**
     * Run $work with the observer inert. Restores the flag even if $work throws,
     * so a failed mint cannot silently disable derivation for the rest of the
     * process.
     *
     * @template T
     *
     * @param  callable(): T  $work
     * @return T
     */
    public static function withoutDerivation(callable $work): mixed
    {
        self::$suspended = true;

        try {
            return $work();
        } finally {
            self::$suspended = false;
        }
    }

    public function created(Model $model): void
    {
        if (self::$suspended) {
            return;
        }

        match (true) {
            $model instanceof Ingredient => $this->derivation->syncIngredient($model),
            $model instanceof CatalogueItem => $this->derivation->syncProduct($model),
            default => null,
        };
    }
}
