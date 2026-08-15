<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The prices of one list, replaced as a set — over storage that never forgets.
 *
 * **The endpoint is set-replace; the storage is effective-dated.** Those are
 * two different shapes and reconciling them is the whole job of this class.
 *
 * A merchandiser thinks in *current state*: here is my tariff, these are the
 * prices, apply it. A PATCH surface over price rows would make "I did not
 * touch the harissa" and "I deleted the harissa" the same request, which on
 * the number a customer is charged is not a difference to leave to a client's
 * diligence — the same argument the recipe line editor and the variant setter
 * make. So the PUT body is the desired **current** pricing state, keyed by
 * pricing point, and the client never sees a date, an interval or a
 * supersession pointer.
 *
 * The database thinks in *history*, because a price is evidence. An order
 * taken last March was taken at last March's price; a table that let a kitchen
 * edit the number afterwards could not reconstruct what the customer was
 * actually charged, and "what did we charge them" is a question the finance
 * team, the customer and eventually a regulator all ask.
 *
 * **The diff, against the standing rows** (`effective_to IS NULL`), keyed by
 * `(catalogue_item_id, catalogue_item_variant_id, min_quantity)`:
 *
 * | submitted | standing | what happens |
 * |---|---|---|
 * | yes | no | insert an open row, `effective_from = today` |
 * | yes | yes, same amount and status | **nothing at all** |
 * | yes | yes, different | close the standing row (`effective_to = today`, `superseded_by_id` → the new row) and insert the replacement open at today |
 * | no | yes | close the standing row; no replacement |
 *
 * "Nothing at all" is load-bearing. Re-submitting an unchanged tariff must not
 * churn the history — a nightly importer that reposts the same sheet would
 * otherwise manufacture a supersession chain hundreds deep and destroy the
 * ability to answer "when did this price actually change".
 *
 * **Nothing is ever mutated or deleted.** The only UPDATE this class issues
 * sets `effective_to` and `superseded_by_id` on a row that had neither; the
 * amount, the status and the dates a row was born with stay as written.
 *
 * A same-day change leaves a zero-length interval behind
 * (`effective_from == effective_to`), which is correct rather than a defect:
 * the price never governed a whole day, and the record that somebody stated it
 * survives. `effective_to` is exclusive precisely so that day has one answer.
 */
final readonly class PriceEntryService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private PriceListService $lists,
    ) {}

    /**
     * @param  list<array{
     *     catalogue_item_id: string,
     *     catalogue_item_variant_id?: string|null,
     *     min_quantity?: int|float|string|null,
     *     unit_amount_minor?: int|string|null,
     *     price_status?: string|null
     * }>  $entries
     *
     * @throws ApiException
     */
    public function replace(PriceList $priceList, array $entries, int $expectedLockVersion): PriceList
    {
        $this->lists->assertEditable($priceList);

        $prepared = $this->prepare($priceList, $entries);
        $today = CarbonImmutable::now()->startOfDay();

        $counts = DB::transaction(function () use ($priceList, $prepared, $today, $expectedLockVersion): array {
            $this->lists->compareAndSwap($priceList, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            /** @var array<string, PriceListItem> $standing */
            $standing = PriceListItem::withoutTenancy()
                ->where('price_list_id', $priceList->getKey())
                ->openRows()
                ->get()
                ->keyBy(fn (PriceListItem $row): string => $this->pointKey(
                    $row->catalogue_item_id,
                    $row->catalogue_item_variant_id,
                    $row->min_quantity,
                ))
                ->all();

            $opened = 0;
            $closed = 0;
            $unchanged = 0;

            foreach ($prepared as $key => $attributes) {
                $incumbent = $standing[$key] ?? null;

                if ($incumbent !== null && $this->statesTheSamePrice($incumbent, $attributes)) {
                    $unchanged++;

                    continue;
                }

                // Close before opening, always. The partial unique index
                // permits exactly one standing row per pricing point, so a
                // replacement inserted while its incumbent is still open would
                // be refused by PostgreSQL — the constraint doing precisely
                // what it was built for, at the one moment the correct
                // sequence makes it invisible.
                if ($incumbent !== null) {
                    $this->close($incumbent, $today);
                    $closed++;
                }

                $replacement = $this->open($priceList, $attributes, $today);
                $opened++;

                // The supersession pointer is a second statement rather than
                // part of the close, and it has to be: it is a foreign key to
                // a row that did not exist a statement ago. Splitting it is
                // what lets the FK stay immediate — a deferred constraint
                // would be a weaker guarantee bought to save one UPDATE.
                if ($incumbent !== null) {
                    $this->link($incumbent, $replacement);
                }
            }

            // Withdrawn points: standing rows the submission did not mention.
            // Closed with no successor, because "we stopped pricing this" is
            // a different fact from "we now price it differently".
            foreach ($standing as $key => $row) {
                if (array_key_exists($key, $prepared)) {
                    continue;
                }

                $this->close($row, $today);
                $closed++;
            }

            return ['opened' => $opened, 'closed' => $closed, 'unchanged' => $unchanged];
        });

        $this->audit->record(
            'catalogue.price_entries_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'price_list',
            subjectId: (string) $priceList->getKey(),
            metadata: [
                'changed_fields' => ['entries'],
                'submitted_count' => count($prepared),
                'opened_count' => $counts['opened'],
                'closed_count' => $counts['closed'],
                'unchanged_count' => $counts['unchanged'],
                'currency' => $priceList->currency_code,
                'lock_version' => $priceList->lock_version,
            ],
        );

        return $priceList;
    }

    /**
     * Whether the standing row already says exactly what the submission says.
     *
     * Amount and status only. Everything else about a row — when it started,
     * what it superseded, who wrote it — is history rather than the price, and
     * a difference there is not a reason to supersede anything.
     *
     * @param  array{unit_amount_minor: int|null, price_status: PriceStatus, ...}  $attributes
     */
    private function statesTheSamePrice(PriceListItem $row, array $attributes): bool
    {
        return $row->price_status === $attributes['price_status']
            && $row->unit_amount_minor === $attributes['unit_amount_minor'];
    }

    /**
     * @param  array{catalogue_item_id: string, catalogue_item_variant_id: string|null, min_quantity: string|null, unit_amount_minor: int|null, price_status: PriceStatus}  $attributes
     */
    private function open(PriceList $priceList, array $attributes, CarbonImmutable $today): PriceListItem
    {
        $row = new PriceListItem;
        $row->organisation_id = $priceList->organisation_id;
        $row->price_list_id = (string) $priceList->getKey();
        $row->catalogue_item_id = $attributes['catalogue_item_id'];
        $row->catalogue_item_variant_id = $attributes['catalogue_item_variant_id'];
        $row->min_quantity = $attributes['min_quantity'];
        $row->unit_amount_minor = $attributes['unit_amount_minor'];
        $row->price_status = $attributes['price_status'];
        $row->effective_from = $today;
        $row->effective_to = null;
        $row->created_by = $this->context->userId();
        $row->save();

        return $row;
    }

    /**
     * Close a standing row: the interval it governed now has an end.
     *
     * One of only two writes this service makes to an existing record, and
     * both touch columns that were NULL. The amount, the status and
     * `effective_from` a row was born with are never written again.
     */
    private function close(PriceListItem $row, CarbonImmutable $today): void
    {
        PriceListItem::withoutTenancy()
            ->whereKey($row->getKey())
            ->update(['effective_to' => $today, 'updated_at' => now()]);
    }

    /**
     * Point a closed row at the row that replaced it, so the chain can be
     * walked forwards from any point in the history.
     */
    private function link(PriceListItem $row, PriceListItem $replacement): void
    {
        PriceListItem::withoutTenancy()
            ->whereKey($row->getKey())
            ->update(['superseded_by_id' => (string) $replacement->getKey(), 'updated_at' => now()]);
    }

    /**
     * Validate and normalise the submitted set, keyed by pricing point.
     *
     * Every reference is checked against *this organisation* rather than
     * merely existing: the tenant scope already narrows the query, and the
     * explicit organisation predicate is the second lock — a price row that
     * named another kitchen's item would be a cross-tenant write with a
     * perfectly valid-looking foreign key.
     *
     * @param  list<array<string, mixed>>  $entries
     * @return array<string, array{catalogue_item_id: string, catalogue_item_variant_id: string|null, min_quantity: string|null, unit_amount_minor: int|null, price_status: PriceStatus}>
     *
     * @throws ApiException
     */
    private function prepare(PriceList $priceList, array $entries): array
    {
        $prepared = [];

        foreach ($entries as $index => $entry) {
            $itemId = $this->usableItemId($priceList, $entry, $index);
            $variantId = $this->usableVariantId($itemId, $entry, $index);
            $minQuantity = $this->minQuantity($entry['min_quantity'] ?? null, $index);
            $status = $this->priceStatus($entry['price_status'] ?? null, $index);
            $amount = $this->amount($entry['unit_amount_minor'] ?? null, $status, $index);

            $key = $this->pointKey($itemId, $variantId, $minQuantity);

            if (array_key_exists($key, $prepared)) {
                throw $this->invalid(
                    "entries.{$index}",
                    'This pricing point is stated twice. One article, one variant and one quantity tier have exactly one price.',
                );
            }

            $prepared[$key] = [
                'catalogue_item_id' => $itemId,
                'catalogue_item_variant_id' => $variantId,
                'min_quantity' => $minQuantity,
                'unit_amount_minor' => $amount,
                'price_status' => $status,
            ];
        }

        return $prepared;
    }

    /**
     * @param  array<string, mixed>  $entry
     *
     * @throws ApiException
     */
    private function usableItemId(PriceList $priceList, array $entry, int $index): string
    {
        $itemId = $this->trimmedOrNull(is_string($entry['catalogue_item_id'] ?? null) ? (string) $entry['catalogue_item_id'] : null);

        if ($itemId === null) {
            throw $this->invalid("entries.{$index}.catalogue_item_id", 'A price has to say what it is the price of.');
        }

        $exists = CatalogueItem::withoutTenancy()
            ->whereKey($itemId)
            ->where('organisation_id', $priceList->organisation_id)
            ->exists();

        if (! $exists) {
            throw $this->invalid("entries.{$index}.catalogue_item_id", 'This catalogue item does not exist, or is not one you can price.');
        }

        return $itemId;
    }

    /**
     * @param  array<string, mixed>  $entry
     *
     * @throws ApiException
     */
    private function usableVariantId(string $itemId, array $entry, int $index): ?string
    {
        $variantId = $this->trimmedOrNull(is_string($entry['catalogue_item_variant_id'] ?? null) ? (string) $entry['catalogue_item_variant_id'] : null);

        if ($variantId === null) {
            return null;
        }

        $belongs = CatalogueItemVariant::withoutTenancy()
            ->whereKey($variantId)
            ->where('catalogue_item_id', $itemId)
            ->exists();

        if (! $belongs) {
            throw $this->invalid("entries.{$index}.catalogue_item_variant_id", 'This variant does not belong to the item being priced.');
        }

        return $variantId;
    }

    /**
     * The tier threshold, normalised to the column's scale so that `10`,
     * `10.0` and `"10.0000"` are one pricing point rather than three.
     *
     * Without the normalisation the partial unique index would happily accept
     * all three — they are distinct text and distinct numerics only until
     * PostgreSQL rounds them — and a merchandiser would end up with a tariff
     * whose "10 or more" tier had two different prices depending on how the
     * client formatted a number.
     *
     * @throws ApiException
     */
    private function minQuantity(mixed $value, int $index): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_numeric($value) || (float) $value <= 0) {
            throw $this->invalid(
                "entries.{$index}.min_quantity",
                'A quantity tier starts above zero. Leave it out for the base price.',
            );
        }

        return number_format((float) $value, 4, '.', '');
    }

    /**
     * @throws ApiException
     */
    private function priceStatus(mixed $value, int $index): PriceStatus
    {
        $status = is_string($value) ? PriceStatus::tryFrom(trim($value)) : null;

        if ($status === null) {
            throw $this->invalid(
                "entries.{$index}.price_status",
                'A price is confirmed, a placeholder, or quoted at market. Those are the only three honest states.',
            );
        }

        return $status;
    }

    /**
     * The amount, refused rather than silently dropped when it contradicts the
     * status.
     *
     * The database CHECK would refuse both mismatches anyway, and it still
     * should — it is what protects the invariant from the importer and from
     * whatever writes this table in three years. What it cannot do is explain
     * itself: a 500 with a constraint name in it teaches a client nothing,
     * whereas "a placeholder is the absence of a price" teaches the rule once.
     *
     * @throws ApiException
     */
    private function amount(mixed $value, PriceStatus $status, int $index): ?int
    {
        $field = "entries.{$index}.unit_amount_minor";
        $present = $value !== null && $value !== '';

        if (! $status->carriesAmount()) {
            if ($present) {
                throw $this->invalid(
                    $field,
                    'A '.$status->value.' row carries no amount — the absence is the statement. Mark it confirmed to state a number.',
                );
            }

            return null;
        }

        if (! $present) {
            throw $this->invalid($field, 'A confirmed price needs a number. Use placeholder or market_priced to say there is not one yet.');
        }

        if (! is_int($value) && (! is_string($value) || preg_match('/^\d+$/', $value) !== 1)) {
            throw $this->invalid($field, 'An amount is a whole number of minor units — 1250 for 12.50, never a decimal and never a formatted string.');
        }

        $amount = (int) $value;

        if ($amount <= 0) {
            throw $this->invalid($field, 'A confirmed price is greater than zero.');
        }

        return $amount;
    }

    /**
     * The identity of a pricing point: article, variant, tier.
     *
     * `min_quantity` is compared as its normalised decimal string, and the
     * NULLs are spelled rather than concatenated away, so that a NULL tier and
     * a literal empty string cannot collide.
     */
    private function pointKey(string $itemId, ?string $variantId, ?string $minQuantity): string
    {
        return $itemId.'|'.($variantId ?? '~').'|'.($minQuantity === null ? '~' : number_format((float) $minQuantity, 4, '.', ''));
    }

    private function trimmedOrNull(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
