<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\B2b\Enums\QuotationStatus;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Models\Quotation;
use Healthy360\B2b\Models\QuotationLine;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Healthy360\Support\Identifiers\IdentifierService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The whole life of one quotation (B3, B5): drafting, submitting, the
 * kitchen's quote, and the buyer's decision.
 *
 * `QuotationStatus` owns the transition table; this service owns the effect
 * of each move, through one private `transition()` exactly as
 * `ApplicationService` does — one place a state can change, one place that
 * can be wrong. An illegal move is `409 b2b.quotation_state_invalid`, never a
 * silent no-op.
 *
 * Lines are the buyer's while the quotation is a draft and the kitchen's
 * prices are the only thing a "quote" ever writes onto them (B4) — enforced
 * here by requiring the submitted state before pricing and refusing any
 * `unit_amount_minor` in the draft-editing paths.
 */
final readonly class QuotationService
{
    public function __construct(
        private AuditRecorder $audit,
        private IdentifierService $identifiers,
    ) {}

    /**
     * @param  array{notes?: string|null, lines?: list<array<string, mixed>>|null}  $attributes
     *
     * @throws ApiException
     */
    public function createDraft(CorporateProgramme $programme, User $actor, array $attributes): Quotation
    {
        $priceList = $this->requireCatalogueTariff($programme);

        return DB::transaction(function () use ($programme, $actor, $attributes, $priceList): Quotation {
            $quotation = new Quotation;
            $quotation->organisation_id = $programme->organisation_id;
            $quotation->corporate_programme_id = $programme->getKey();
            $quotation->reference = $this->generateReference();
            $quotation->status = QuotationStatus::Draft;
            $quotation->currency_code = $priceList->currency_code;
            $quotation->notes = $this->trimmedOrNull($attributes['notes'] ?? null);
            $quotation->created_by = (string) $actor->getKey();
            $quotation->updated_by = (string) $actor->getKey();
            $quotation->lock_version = 0;
            $quotation->save();

            if (array_key_exists('lines', $attributes) && $attributes['lines'] !== null) {
                $this->writeLines($quotation, $programme, $attributes['lines']);
            }

            $this->audit->record(
                'b2b.quotation_drafted',
                actorUserId: (string) $actor->getKey(),
                subjectType: 'quotation',
                subjectId: (string) $quotation->getKey(),
                metadata: [
                    'reference' => $quotation->reference,
                    'corporate_programme_id' => (string) $programme->getKey(),
                ],
            );

            return $quotation->refresh();
        });
    }

    /**
     * @param  array{notes?: string|null, lines?: list<array<string, mixed>>|null}  $attributes
     *
     * @throws ApiException
     */
    public function updateDraft(Quotation $quotation, User $actor, array $attributes, int $expectedLockVersion): Quotation
    {
        $this->assertLinesEditable($quotation);

        return DB::transaction(function () use ($quotation, $actor, $attributes, $expectedLockVersion): Quotation {
            $changes = [];

            if (array_key_exists('notes', $attributes)) {
                $changes['notes'] = $this->trimmedOrNull($attributes['notes']);
            }

            $changes['updated_by'] = (string) $actor->getKey();

            $this->write($quotation, $changes, $expectedLockVersion);

            if (array_key_exists('lines', $attributes) && $attributes['lines'] !== null) {
                $programme = $quotation->programme()->firstOrFail();
                $this->writeLines($quotation, $programme, $attributes['lines']);
            }

            $this->audit->record(
                'b2b.quotation_draft_updated',
                actorUserId: (string) $actor->getKey(),
                subjectType: 'quotation',
                subjectId: (string) $quotation->getKey(),
                metadata: [
                    'reference' => $quotation->reference,
                    'changed_fields' => array_values(array_diff(array_keys($changes), ['updated_by'])),
                    'lines_replaced' => array_key_exists('lines', $attributes) && $attributes['lines'] !== null,
                    'lock_version' => $quotation->lock_version,
                ],
            );

            return $quotation->refresh();
        });
    }

    /**
     * Draft → submitted. The buyer's ask for prices.
     *
     * @throws ApiException
     */
    public function submit(Quotation $quotation, User $actor, int $expectedLockVersion): Quotation
    {
        $lineCount = QuotationLine::withoutTenancy()->where('quotation_id', $quotation->getKey())->count();

        if ($lineCount === 0) {
            throw new ApiException(
                ErrorCode::B2bQuotationEmpty,
                'This quotation has no lines to submit.',
                ['current_lock_version' => $quotation->lock_version],
            );
        }

        return $this->transition($quotation, QuotationStatus::Submitted, $actor, [
            'submitted_at' => now(),
            'submitted_by' => (string) $actor->getKey(),
        ], $expectedLockVersion, ['line_count' => $lineCount]);
    }

    /**
     * Submitted → quoted. The kitchen (or platform, on its behalf) names a
     * price for every line — never fewer, never more (B4): a partial quote
     * would leave the buyer deciding against a total that is not really the
     * total, and an extra line names an article the buyer never asked for.
     *
     * `$prices` is typed loosely on purpose. The form request has already checked the shape, but a
     * service that trusted a docblock would stop checking — and this one is reachable from the
     * platform's side of the same relationship as well as from the kitchen's. The per-entry
     * guards below are the real validation, and a narrow annotation here would make them look
     * redundant to a reader and to the static analyser both.
     *
     * @param  list<array<string, mixed>>  $prices
     *
     * @throws ApiException
     */
    public function quote(Quotation $quotation, User $actor, array $prices, int $expectedLockVersion): Quotation
    {
        if (! $quotation->status->canTransitionTo(QuotationStatus::Quoted)) {
            throw new ApiException(
                ErrorCode::B2bQuotationStateInvalid,
                "A quotation that is {$quotation->status->value} cannot become quoted.",
                [
                    'status' => $quotation->status->value,
                    'requested_status' => QuotationStatus::Quoted->value,
                    'allowed_transitions' => array_map(
                        static fn (QuotationStatus $status): string => $status->value,
                        $quotation->status->allowedTransitions(),
                    ),
                    'current_lock_version' => $quotation->lock_version,
                ],
            );
        }

        $lines = QuotationLine::withoutTenancy()
            ->where('quotation_id', $quotation->getKey())
            ->get()
            ->keyBy(fn (QuotationLine $line): string => (string) $line->getKey());

        $submitted = [];

        foreach ($prices as $index => $price) {
            $lineId = is_string($price['quotation_line_id'] ?? null) ? $price['quotation_line_id'] : '';
            $line = $lines->get($lineId);

            if (! $line instanceof QuotationLine) {
                throw $this->invalid("prices.{$index}.quotation_line_id", 'This line does not belong to this quotation.');
            }

            if (array_key_exists($lineId, $submitted)) {
                throw $this->invalid("prices.{$index}.quotation_line_id", 'This line is priced twice.');
            }

            $submitted[$lineId] = $this->amountMinor($price['unit_amount_minor'] ?? null, "prices.{$index}.unit_amount_minor");
        }

        $missing = array_diff($lines->keys()->all(), array_keys($submitted));

        if ($missing !== []) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'Every line on this quotation needs a price.',
                ['fields' => ['prices' => ['missing_quotation_line_ids' => array_values($missing)]]],
            );
        }

        $now = CarbonImmutable::now();

        return DB::transaction(function () use ($quotation, $actor, $lines, $submitted, $expectedLockVersion, $now): Quotation {
            foreach ($submitted as $lineId => $unitAmountMinor) {
                $line = $lines->get($lineId);
                $lineTotal = (int) round(((float) $line->quantity) * $unitAmountMinor);

                QuotationLine::withoutTenancy()->whereKey($lineId)->update([
                    'unit_amount_minor' => $unitAmountMinor,
                    'line_total_minor' => $lineTotal,
                    'updated_at' => $now,
                ]);
            }

            return $this->transition($quotation, QuotationStatus::Quoted, $actor, [
                'quoted_at' => $now,
                'quoted_by' => (string) $actor->getKey(),
                'expires_at' => $now->addDays(7),
            ], $expectedLockVersion, ['line_count' => $lines->count()]);
        });
    }

    /**
     * Quoted → accepted.
     *
     * **The only side-effect is that nothing new happens (B6).** Catalogue
     * access for this buyer is already governed entirely by the agreement's
     * active price list — `BuyerAgreementLookup` resolves it fresh on every
     * browse — and acceptance changes neither the agreement nor the price
     * list, so there is no catalogue grant to refresh. What acceptance
     * actually records is that the buyer confirmed a total; if the agreement
     * itself is not active, catalogue browsing is already refused for a
     * reason that has nothing to do with this quotation.
     *
     * @throws ApiException
     */
    public function accept(Quotation $quotation, User $actor, int $expectedLockVersion): Quotation
    {
        $this->assertNotPastExpiry($quotation);

        return $this->transition($quotation, QuotationStatus::Accepted, $actor, [
            'decided_at' => now(),
            'decided_by' => (string) $actor->getKey(),
        ], $expectedLockVersion);
    }

    /**
     * Quoted → declined.
     *
     * @throws ApiException
     */
    public function decline(Quotation $quotation, User $actor, ?string $reason, int $expectedLockVersion): Quotation
    {
        $this->assertNotPastExpiry($quotation);

        return $this->transition($quotation, QuotationStatus::Declined, $actor, [
            'decided_at' => now(),
            'decided_by' => (string) $actor->getKey(),
            'decline_reason' => $this->trimmedOrNull($reason),
        ], $expectedLockVersion);
    }

    /**
     * Quoted → expired, seven days after `quoted_at` (B5). Batched, a single
     * `UPDATE` per batch, one log line — the same trade-off
     * `ExpireStaleCarts` makes and for the same reason: a nightly sweep that
     * closes thousands of rows should not fill the audit trail with one event
     * per row describing the passage of time.
     *
     * `withoutTenancy()` is the deliberate, auditable bypass this sweep
     * exists for: it runs on the queue with no `X-Organisation-Id` published,
     * exactly like `GenerationService::tick()`, and the migration's isolation
     * note is why that is safe — the trait fails loud without a context, a
     * PostgreSQL policy would have failed silent, and this is the one call
     * site that means to see every organisation at once.
     */
    public function expireDue(CarbonImmutable $now, int $chunk = 500): int
    {
        $expired = 0;

        do {
            /** @var list<string> $batch */
            $batch = Quotation::withoutTenancy()
                ->where('status', QuotationStatus::Quoted->value)
                ->where('expires_at', '<=', $now)
                ->limit($chunk)
                ->pluck('id')
                ->all();

            if ($batch === []) {
                break;
            }

            $expired += DB::transaction(fn (): int => Quotation::withoutTenancy()
                ->whereIn('id', $batch)
                ->update(['status' => QuotationStatus::Expired->value, 'updated_at' => $now]));
        } while (count($batch) === $chunk);

        Log::info('Quotations expired.', ['expired' => $expired]);

        return $expired;
    }

    /**
     * @throws ApiException
     */
    private function requireCatalogueTariff(CorporateProgramme $programme): PriceList
    {
        $agreement = $programme->agreement()->first();
        $priceList = $agreement?->price_list_id !== null
            ? PriceList::withoutTenancy()->whereKey($agreement->price_list_id)->first()
            : null;

        if (! $priceList instanceof PriceList) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                "This programme's agreement carries no catalogue tariff yet, so a quotation cannot be drafted against it.",
            );
        }

        return $priceList;
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     *
     * @throws ApiException
     */
    private function writeLines(Quotation $quotation, CorporateProgramme $programme, array $lines): void
    {
        $prepared = [];

        foreach ($lines as $index => $line) {
            $itemId = is_string($line['catalogue_item_id'] ?? null) ? trim($line['catalogue_item_id']) : '';

            if ($itemId === '') {
                throw $this->invalid("lines.{$index}.catalogue_item_id", 'A line has to name what it is a quantity of.');
            }

            $item = CatalogueItem::withoutTenancy()
                ->whereKey($itemId)
                ->where('organisation_id', $programme->kitchen_organisation_id)
                ->first();

            if (! $item instanceof CatalogueItem) {
                throw $this->invalid("lines.{$index}.catalogue_item_id", "This article does not exist, or is not one this programme's kitchen sells.");
            }

            $variantId = is_string($line['catalogue_item_variant_id'] ?? null) ? trim($line['catalogue_item_variant_id']) : null;

            if ($variantId !== null && $variantId !== '') {
                $belongs = CatalogueItemVariant::withoutTenancy()
                    ->whereKey($variantId)
                    ->where('catalogue_item_id', $item->getKey())
                    ->exists();

                if (! $belongs) {
                    throw $this->invalid("lines.{$index}.catalogue_item_variant_id", 'This variant does not belong to the article on this line.');
                }
            } else {
                $variantId = null;
            }

            $quantity = $line['quantity'] ?? null;

            if (! is_numeric($quantity) || (float) $quantity <= 0) {
                throw $this->invalid("lines.{$index}.quantity", 'A line needs a quantity greater than zero.');
            }

            $note = is_string($line['note'] ?? null) ? trim((string) $line['note']) : null;

            $prepared[] = [
                'catalogue_item_id' => (string) $item->getKey(),
                'catalogue_item_variant_id' => $variantId,
                'quantity' => number_format((float) $quantity, 4, '.', ''),
                'note' => $note === '' ? null : $note,
            ];
        }

        QuotationLine::withoutTenancy()->where('quotation_id', $quotation->getKey())->delete();

        foreach ($prepared as $position => $attributes) {
            $line = new QuotationLine;
            $line->organisation_id = $quotation->organisation_id;
            $line->quotation_id = $quotation->getKey();
            $line->line_number = $position + 1;
            $line->catalogue_item_id = $attributes['catalogue_item_id'];
            $line->catalogue_item_variant_id = $attributes['catalogue_item_variant_id'];
            $line->quantity = $attributes['quantity'];
            $line->note = $attributes['note'];
            $line->created_by = $quotation->updated_by;
            $line->save();
        }
    }

    /**
     * @param  array<string, mixed>  $changes
     * @param  array<string, scalar|list<scalar>|null>  $metadata
     *
     * @throws ApiException
     */
    private function transition(
        Quotation $quotation,
        QuotationStatus $next,
        User $actor,
        array $changes,
        int $expectedLockVersion,
        array $metadata = [],
    ): Quotation {
        $current = $quotation->status;

        if (! $current->canTransitionTo($next)) {
            throw new ApiException(
                ErrorCode::B2bQuotationStateInvalid,
                "A quotation that is {$current->value} cannot become {$next->value}.",
                [
                    'status' => $current->value,
                    'requested_status' => $next->value,
                    'allowed_transitions' => array_map(
                        static fn (QuotationStatus $status): string => $status->value,
                        $current->allowedTransitions(),
                    ),
                    'current_lock_version' => $quotation->lock_version,
                ],
            );
        }

        $changes['status'] = $next->value;
        $changes['updated_by'] = (string) $actor->getKey();

        $this->write($quotation, $changes, $expectedLockVersion);

        $this->audit->record(
            'b2b.quotation_'.$next->value,
            actorUserId: (string) $actor->getKey(),
            subjectType: 'quotation',
            subjectId: (string) $quotation->getKey(),
            metadata: $metadata + [
                'from_status' => $current->value,
                'to_status' => $next->value,
                'reference' => $quotation->reference,
            ],
        );

        return $quotation;
    }

    /**
     * @throws ApiException
     */
    private function assertLinesEditable(Quotation $quotation): void
    {
        if (! $quotation->status->linesAreEditable()) {
            throw new ApiException(
                ErrorCode::B2bQuotationStateInvalid,
                'This quotation is no longer a draft and cannot be changed here.',
                ['status' => $quotation->status->value, 'current_lock_version' => $quotation->lock_version],
            );
        }
    }

    /**
     * A quotation left `quoted` past its `expires_at` behaves as expired even
     * before the sweep has caught up with it — the buyer's clock does not
     * wait for a queue worker.
     *
     * @throws ApiException
     */
    private function assertNotPastExpiry(Quotation $quotation): void
    {
        if ($quotation->status === QuotationStatus::Quoted
            && $quotation->expires_at instanceof CarbonImmutable
            && $quotation->expires_at->isPast()) {
            throw new ApiException(
                ErrorCode::B2bQuotationStateInvalid,
                'This quotation has expired and can no longer be decided.',
                ['status' => 'expired', 'current_lock_version' => $quotation->lock_version],
            );
        }
    }

    /**
     * @param  array<string, mixed>  $changes
     *
     * @throws StaleLockVersion
     */
    private function write(Quotation $quotation, array $changes, int $expectedLockVersion): void
    {
        $affected = Quotation::withoutTenancy()
            ->whereKey($quotation->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update($changes + [
                'lock_version' => $expectedLockVersion + 1,
                'updated_at' => now(),
            ]);

        if ($affected === 0) {
            $current = Quotation::withoutTenancy()->whereKey($quotation->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $quotation->refresh();
    }

    /**
     * @throws ApiException
     */
    private function amountMinor(mixed $value, string $field): int
    {
        if (! is_int($value) && (! is_string($value) || preg_match('/^\d+$/', $value) !== 1)) {
            throw $this->invalid($field, 'An amount is a whole number of minor units — 1250 for 12.50, never a decimal and never a formatted string.');
        }

        $amount = (int) $value;

        if ($amount < 0) {
            throw $this->invalid($field, 'A price cannot be negative.');
        }

        return $amount;
    }

    private function trimmedOrNull(mixed $value): ?string
    {
        if (! is_string($value)) {
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

    /**
     * A reference a person can read over the phone. Uniqueness is the
     * index's job; the retry is here so a collision is a hiccup rather than
     * a 500.
     */
    private function generateReference(): string
    {
        $year = CarbonImmutable::now()->format('Y');

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $suffix = mb_strtoupper(mb_substr(str_replace('-', '', $this->identifiers->generate()), -8));
            $reference = "QUO-{$year}-{$suffix}";

            if (! Quotation::withoutTenancy()->where('reference', $reference)->exists()) {
                return $reference;
            }
        }

        throw new ApiException(ErrorCode::ServerInternalError, 'Could not allocate a unique quotation reference.');
    }
}
