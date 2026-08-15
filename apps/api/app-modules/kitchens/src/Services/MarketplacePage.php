<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Support\Api\CursorPage;
use Illuminate\Database\Eloquent\Builder;

/**
 * A keyset page whose rows can still be rejected after the query has run.
 *
 * ## Why this exists
 *
 * Two of the marketplace's rules cannot be expressed in the query that finds
 * the rows. Whether a meal has a price is the answer `PriceResolver` gives
 * after walking a channel's tariffs in priority order; whether it contains an
 * allergen is what `DerivedAllergenService` computes from a published recipe
 * version or an ingredient list. Both are real domain logic with their own
 * tests, and reimplementing either as a subquery would mean two implementations
 * of a rule that must have one — which is the mistake the whole
 * "one resolver, one answer" design exists to prevent.
 *
 * So the rows are fetched, projected, and some of them are dropped. The
 * difficulty is that `CursorPage` counts the rows it *fetched*, so a page that
 * drops four of twenty-five would report twenty-one items and a `has_more` that
 * means something else. This walks instead: fetch a batch, project it, keep
 * what survives, advance the cursor to the last row **examined**, and repeat
 * until there are enough survivors or the source runs out.
 *
 * `next_cursor` is the keyset of the last row **kept**, never the last examined
 * — rows rejected after it are examined again on the next page and rejected
 * again, which costs a little and cannot lose a row. The reverse (advancing
 * past rejected rows) would silently skip anything whose price arrived between
 * two requests.
 *
 * Typed to `CatalogueItem` rather than made generic. It has exactly one
 * consumer — the meal page — and a template parameter here bought nothing but a
 * variance argument with the type checker. Generalising it is a two-line change
 * on the day a second surface needs it, with a real second case to design
 * against rather than an imagined one.
 *
 * `MAX_PASSES` bounds the work. A catalogue where almost nothing is priced
 * would otherwise walk the whole table to fill one page. On hitting the bound
 * the page is returned short with `has_more: true` and a cursor to continue
 * from: "there may be more, carry on from here" is true, and an unbounded query
 * on an anonymous endpoint is a denial-of-service waiting to be found.
 */
final class MarketplacePage
{
    /** How many batches one request may examine before answering with what it has. */
    public const int MAX_PASSES = 8;

    /**
     * @param  Builder<CatalogueItem>  $query  a fresh query; it is cloned per pass
     * @param  callable(CatalogueItem): (array<string, mixed>|null)  $project  null rejects the row
     * @return array{items: list<array<string, mixed>>, meta: array{count: int, next_cursor: string|null, has_more: bool}}
     */
    public static function walk(Builder $query, int $limit, ?string $cursor, callable $project): array
    {
        /** @var list<array<string, mixed>> $kept */
        $kept = [];
        /** @var list<CatalogueItem> $keptModels */
        $keptModels = [];

        // Over-fetch: a batch the size of the page would need a second pass for
        // every single rejection.
        $batch = max($limit * 2, CursorPage::DEFAULT_LIMIT);
        $position = $cursor;
        $exhausted = false;
        $lastExamined = null;

        for ($pass = 0; $pass < self::MAX_PASSES; $pass++) {
            $scoped = clone $query;
            CursorPage::constrain($scoped, $batch, $position);

            $rows = $scoped->get();

            // `constrain()` asks for one row beyond the batch, so fewer than
            // that means the source is finished.
            if ($rows->count() <= $batch) {
                $exhausted = true;
            }

            $examined = $rows->take($batch);

            if ($examined->isEmpty()) {
                $exhausted = true;

                break;
            }

            $lastExamined = $examined->last();

            foreach ($examined as $row) {
                $projected = $project($row);

                if ($projected === null) {
                    continue;
                }

                $kept[] = $projected;
                $keptModels[] = $row;

                if (count($kept) > $limit) {
                    break;
                }
            }

            if (count($kept) > $limit) {
                break;
            }

            if ($exhausted) {
                break;
            }

            // `$examined` is non-empty here — the empty case broke out above —
            // so the last row is the keyset to continue from.
            $position = CursorPage::encode($lastExamined);
        }

        $hasMore = count($kept) > $limit || ! $exhausted;
        $items = array_slice($kept, 0, $limit);

        // The keyset to continue from is the last row **kept**, so anything
        // rejected after it is examined again rather than skipped. When the
        // pass bound was reached with nothing kept at all there is no such row,
        // and the last row *examined* is the honest continuation: saying
        // "no more results" there would silently truncate a catalogue whose
        // priced meals happen to sit beyond the eighth batch.
        $continueFrom = $keptModels[count($items) - 1] ?? ($hasMore ? $lastExamined : null);

        return [
            'items' => $items,
            'meta' => [
                'count' => count($items),
                'next_cursor' => $hasMore && $continueFrom !== null ? CursorPage::encode($continueFrom) : null,
                'has_more' => $hasMore && $continueFrom !== null,
            ],
        ];
    }
}
