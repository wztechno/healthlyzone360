<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Contracts\SellingPlaceRegistry;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;

/**
 * Whether a sold item can actually be bought: a pack, a place, and a price for
 * every place it is offered on.
 *
 * One evaluator, asked two ways: {@see self::reasons()} over what is stored,
 * and {@see self::evaluate()} over a statement a write is about to commit —
 * the packs write applies the published-listing rule through it, so the rule
 * is the same one publication asks.
 *
 * Reasons share `CatalogueItemReadiness`'s shape, `{code, detail, context}`:
 *
 * - `no_pack` — no active pack, so nothing has a size to sell.
 * - `no_selling_place` — offered nowhere.
 * - `place_unpriced` — offered on a place where no active pack has a standing
 *   price, its own or inherited; `context.place` names it. The counter is
 *   priced by the list the desk quotes from, which is the Home shop's while it
 *   follows it.
 */
final readonly class SellingReadiness
{
    /** @var list<'home'|'business'|'counter'> */
    public const array PLACES = ['home', 'business', 'counter'];

    public function __construct(private SellingPlaceRegistry $places) {}

    /**
     * Why the item, as stored, cannot be sold.
     *
     * @return list<array{code: string, detail: string, context: array<string, mixed>}>
     */
    public function reasons(CatalogueItem $item): array
    {
        $hasPack = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('variant_type', VariantType::Pack->value)
            ->where('status', VariantStatus::Active->value)
            ->exists();

        $places = $this->places->placesOf($item);

        return self::evaluate($hasPack, $places['offered'], $places['priced']);
    }

    /**
     * The rule itself, over any state.
     *
     * @param  list<string>  $offered  the places the item is offered on
     * @param  list<string>  $priced  the places at least one active pack is priced on
     * @return list<array{code: string, detail: string, context: array<string, mixed>}>
     */
    public static function evaluate(bool $hasPack, array $offered, array $priced): array
    {
        $reasons = [];

        if (! $hasPack) {
            $reasons[] = [
                'code' => 'no_pack',
                'detail' => 'This item has no pack, so there is no size a customer could buy. Add a pack on Packs & prices.',
                'context' => [],
            ];
        }

        if ($offered === []) {
            $reasons[] = [
                'code' => 'no_selling_place',
                'detail' => 'This item is not offered anywhere. Tick Home shop, Business or Counter on Packs & prices.',
                'context' => [],
            ];
        }

        foreach (self::PLACES as $place) {
            if (in_array($place, $offered, true) && ! in_array($place, $priced, true)) {
                $reasons[] = [
                    'code' => 'place_unpriced',
                    'detail' => 'This item is offered on a place where no pack has a price, so nothing can be bought there. Price a pack for it, or untick it.',
                    'context' => ['place' => $place],
                ];
            }
        }

        return $reasons;
    }
}
