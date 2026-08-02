<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Services;

use Carbon\CarbonImmutable;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Enums\CustomerScope;
use Healthy360\Pricing\Enums\PriceListStatus;
use Healthy360\Pricing\Enums\PriceStatus;
use Healthy360\Pricing\Exceptions\PublishBlocked;
use Healthy360\Pricing\Models\ChannelPriceList;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Pricing\Models\PriceListItem;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Api\Exceptions\StaleLockVersion;
use Healthy360\Tenancy\TenantContext;

/**
 * Every write to a price list header.
 *
 * Three rules run through it.
 *
 * 1. **`code` is immutable.** Like a catalogue item's slug and a sales
 *    channel's code, and for the same reason: it is what an importer, a
 *    channel assignment and an operator's runbook already wrote down. A
 *    request carrying `code` on update is refused rather than ignored, because
 *    a client that sent it believed it was writing something.
 *
 * 2. **The currency freezes at the first item row.** Not at creation — a list
 *    that has never priced anything is still a blank form, and a kitchen that
 *    picked the wrong currency before typing a single number should fix it
 *    rather than start again. After that it is refused with
 *    `409 resource.conflict`, because changing it would silently re-denominate
 *    every amount in the list: 4 500 minor units is 45 AED or 45 USD depending
 *    on a field nobody edited, and the *history* — rows closed under the old
 *    currency, prices customers were actually charged — cannot be
 *    re-denominated at all. The conflict carries `reason: currency_locked` and
 *    the count of rows holding it, so the answer is "make a new list", not
 *    "reload and retry".
 *
 * 3. **Activation and archiving are POST sub-resource actions**, never a
 *    `status` field on the update (master plan v2 §4.15). `status` is not in
 *    the update rules and not accepted here.
 *
 * `customer_scope` **is** editable, deliberately, even though it is the
 * confidentiality boundary. A tariff drafted as public that turns out to be
 * one client's deal has to be reclassifiable, and the reverse — a negotiated
 * sheet a kitchen decides to publish as its standard trade tariff — is a real
 * commercial event rather than a mistake. The protection is that the change
 * requires `price_list.manage_organisation`, the commercial authority, and
 * lands in the audit trail naming both scopes.
 */
final readonly class PriceListService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{
     *     code: string,
     *     name_en: string,
     *     name_ar?: string|null,
     *     currency_code: string,
     *     customer_scope?: string|null,
     *     branch_id?: string|null,
     *     valid_from?: string|null,
     *     valid_to?: string|null
     * }  $attributes
     *
     * @throws ApiException
     */
    public function create(array $attributes): PriceList
    {
        $organisationId = $this->requireOrganisation();
        $code = trim($attributes['code']);

        if (PriceList::withoutTenancy()->where('organisation_id', $organisationId)->where('code', $code)->exists()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This organisation already has a price list with that code.',
                ['conflicting_field' => 'code'],
            );
        }

        $currency = $this->validatedCurrency($attributes['currency_code']);
        $scope = $this->validatedScope($attributes['customer_scope'] ?? null) ?? CustomerScope::PublicTariff;
        $branchId = $this->validatedBranchId($attributes['branch_id'] ?? null, $organisationId);
        $window = $this->validatedWindow($attributes['valid_from'] ?? null, $attributes['valid_to'] ?? null);

        $priceList = new PriceList;
        $priceList->organisation_id = $organisationId;
        $priceList->branch_id = $branchId;
        $priceList->code = $code;
        $priceList->name_en = trim($attributes['name_en']);
        $priceList->name_ar = $this->trimmedOrNull($attributes['name_ar'] ?? null) ?? '';
        $priceList->currency_code = $currency;
        $priceList->customer_scope = $scope;
        $priceList->status = PriceListStatus::Draft;
        $priceList->valid_from = $window['valid_from'];
        $priceList->valid_to = $window['valid_to'];
        $priceList->lock_version = 0;
        $priceList->created_by = $this->context->userId();
        $priceList->updated_by = $this->context->userId();
        $priceList->save();

        $this->audit->record(
            'catalogue.price_list_created',
            actorUserId: $this->context->userId(),
            subjectType: 'price_list',
            subjectId: (string) $priceList->getKey(),
            metadata: [
                'currency' => $currency,
                'customer_scope' => $scope->value,
                'status' => $priceList->status->value,
            ],
        );

        return $priceList;
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(PriceList $priceList, array $attributes, int $expectedLockVersion): PriceList
    {
        $this->assertEditable($priceList);

        if (array_key_exists('code', $attributes)) {
            throw $this->invalid('code', 'A price list code is fixed when the list is created. Rename the list instead.');
        }

        $organisationId = $this->requireOrganisation();
        $changes = [];

        foreach (['name_en', 'name_ar'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];
            $changes[$field] = is_string($value) ? trim($value) : $value;
        }

        if (($changes['name_en'] ?? null) === '') {
            throw $this->invalid('name_en', 'A price list must have a name.');
        }

        if (array_key_exists('currency_code', $attributes)) {
            $changes['currency_code'] = $this->relocatedCurrency($priceList, $attributes['currency_code']);
        }

        if (array_key_exists('customer_scope', $attributes)) {
            $scope = $this->validatedScope($attributes['customer_scope']);

            if ($scope === null) {
                throw $this->invalid('customer_scope', 'A price list is either a public tariff or an agreement.');
            }

            $changes['customer_scope'] = $scope->value;
        }

        if (array_key_exists('branch_id', $attributes)) {
            $changes['branch_id'] = $this->validatedBranchId($attributes['branch_id'], $organisationId);
        }

        if (array_key_exists('valid_from', $attributes) || array_key_exists('valid_to', $attributes)) {
            $window = $this->validatedWindow(
                array_key_exists('valid_from', $attributes) ? $attributes['valid_from'] : $priceList->valid_from?->toDateString(),
                array_key_exists('valid_to', $attributes) ? $attributes['valid_to'] : $priceList->valid_to?->toDateString(),
            );

            $changes['valid_from'] = $window['valid_from'];
            $changes['valid_to'] = $window['valid_to'];
        }

        if ($changes === []) {
            return $priceList;
        }

        $changes['updated_by'] = $this->context->userId();

        $this->compareAndSwap($priceList, $changes, $expectedLockVersion);

        $this->audit->record(
            'catalogue.price_list_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'price_list',
            subjectId: (string) $priceList->getKey(),
            metadata: [
                'changed_fields' => array_values(array_diff(array_keys($changes), ['updated_by'])),
                'lock_version' => $priceList->lock_version,
            ],
        );

        return $priceList;
    }

    /**
     * Draft → active.
     *
     * The gate is deliberately short, and what it does **not** check is the
     * interesting half: placeholder and market-priced rows are perfectly
     * legitimate on an active list. A kitchen that has confirmed forty prices
     * and still owes eight should be able to trade on the forty, and the
     * eight are honest about being unpriced. What stops them reaching a
     * customer is the public projection — `confirmedOpenRows()` — not a
     * lifecycle refusal here, because a gate that demanded a complete tariff
     * would push somebody to invent the missing numbers, which is the exact
     * failure OD-2 exists to prevent.
     *
     * What it does check is that the list prices *something*. A tariff with no
     * standing rows assigned to a live channel is a silent "nothing is for
     * sale here", and it looks identical to a working configuration.
     *
     * @throws ApiException
     */
    public function publish(PriceList $priceList, int $expectedLockVersion): PriceList
    {
        $reasons = [];

        if ($priceList->status !== PriceListStatus::Draft) {
            $reasons[] = ['reason' => 'price_list_not_a_draft', 'status' => $priceList->status->value];
        }

        $openRows = PriceListItem::withoutTenancy()
            ->where('price_list_id', $priceList->getKey())
            ->openRows()
            ->get();

        if ($openRows->isEmpty()) {
            $reasons[] = ['reason' => 'no_open_rows'];
        }

        // Structurally unreachable — the CHECK on `price_list_items` refuses
        // both halves of the mismatch — and stated anyway, because the gate is
        // what a client reads and "the database would have caught it" is not
        // visible from there.
        $mismatched = $openRows
            ->filter(static fn (PriceListItem $row): bool => $row->price_status->carriesAmount() !== ($row->unit_amount_minor !== null))
            ->map(static fn (PriceListItem $row): string => (string) $row->getKey())
            ->values()
            ->all();

        if ($mismatched !== []) {
            $reasons[] = ['reason' => 'amount_status_mismatch', 'price_list_item_ids' => $mismatched];
        }

        if ($reasons !== []) {
            throw new PublishBlocked($reasons);
        }

        $this->compareAndSwap($priceList, [
            'status' => PriceListStatus::Active->value,
            'updated_by' => $this->context->userId(),
        ], $expectedLockVersion);

        $this->audit->record(
            'catalogue.price_list_published',
            actorUserId: $this->context->userId(),
            subjectType: 'price_list',
            subjectId: (string) $priceList->getKey(),
            metadata: [
                'status' => PriceListStatus::Active->value,
                'open_row_count' => $openRows->count(),
                'confirmed_row_count' => $openRows->filter(
                    static fn (PriceListItem $row): bool => $row->price_status === PriceStatus::Confirmed,
                )->count(),
                'lock_version' => $priceList->lock_version,
            ],
        );

        return $priceList;
    }

    /**
     * → archived, and only from a list no channel is still pricing from.
     *
     * The refusal is the point. Archiving a list a channel still names would
     * not stop the channel quoting from it — the assignment row would still be
     * there, and the resolver would still walk it — so the archive would be a
     * label that changed nothing, which is worse than a refusal. Detaching the
     * list from its channels is the act that actually withdraws the tariff;
     * archiving is what records that nobody intends to go back to it.
     *
     * Nothing is deleted: the entries stay, the history stays, and an order
     * placed last spring can still be explained.
     *
     * @throws ApiException
     */
    public function archive(PriceList $priceList, int $expectedLockVersion): PriceList
    {
        if ($priceList->status === PriceListStatus::Archived) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This price list is already archived.',
                ['status' => $priceList->status->value, 'current_lock_version' => $priceList->lock_version],
            );
        }

        /** @var list<string> $channelIds */
        $channelIds = ChannelPriceList::withoutTenancy()
            ->where('price_list_id', $priceList->getKey())
            ->orderBy('priority')
            ->pluck('sales_channel_id')
            ->all();

        if ($channelIds !== []) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This price list is still assigned to a sales channel. Remove the assignment first — archiving would leave the channel quoting from it.',
                ['reason' => 'channel_assignments_active', 'sales_channel_ids' => $channelIds],
            );
        }

        $this->compareAndSwap($priceList, [
            'status' => PriceListStatus::Archived->value,
            'updated_by' => $this->context->userId(),
        ], $expectedLockVersion);

        $this->audit->record(
            'catalogue.price_list_archived',
            actorUserId: $this->context->userId(),
            subjectType: 'price_list',
            subjectId: (string) $priceList->getKey(),
            metadata: [
                'status' => PriceListStatus::Archived->value,
                'lock_version' => $priceList->lock_version,
            ],
        );

        return $priceList;
    }

    /**
     * An archived list is frozen — entries and channel assignments included.
     *
     * @throws ApiException
     */
    public function assertEditable(PriceList $priceList): void
    {
        if (! $priceList->isEditable()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'An archived price list cannot be changed. Create a replacement instead.',
                ['status' => $priceList->status->value, 'current_lock_version' => $priceList->lock_version],
            );
        }
    }

    /**
     * The conditional update that makes `If-Match` mean something: a single
     * `UPDATE … WHERE lock_version = ?`, never a read followed by a write.
     *
     * @param  array<string, mixed>  $changes
     *
     * @throws StaleLockVersion
     */
    public function compareAndSwap(PriceList $priceList, array $changes, int $expectedLockVersion): void
    {
        $affected = PriceList::withoutTenancy()
            ->whereKey($priceList->getKey())
            ->where('lock_version', $expectedLockVersion)
            ->update($changes + [
                'lock_version' => $expectedLockVersion + 1,
                'updated_at' => now(),
            ]);

        if ($affected === 0) {
            $current = PriceList::withoutTenancy()->whereKey($priceList->getKey())->value('lock_version');

            throw new StaleLockVersion(is_numeric($current) ? (int) $current : $expectedLockVersion);
        }

        $priceList->refresh();
    }

    /**
     * @throws ApiException
     */
    private function relocatedCurrency(PriceList $priceList, mixed $value): string
    {
        $currency = $this->validatedCurrency($value);

        if ($currency === $priceList->currency_code) {
            return $currency;
        }

        $rows = PriceListItem::withoutTenancy()->where('price_list_id', $priceList->getKey())->count();

        if ($rows > 0) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'This price list already holds amounts in '.$priceList->currency_code.'. A currency cannot be changed under existing prices — create a new list instead.',
                [
                    'reason' => 'currency_locked',
                    'current_currency' => $priceList->currency_code,
                    'requested_currency' => $currency,
                    'entry_count' => $rows,
                    'current_lock_version' => $priceList->lock_version,
                ],
            );
        }

        return $currency;
    }

    /**
     * @throws ApiException
     */
    private function validatedCurrency(mixed $value): string
    {
        $code = is_string($value) ? mb_strtoupper(trim($value)) : '';

        if ($code === '' || ! Currency::query()->whereKey($code)->exists()) {
            throw $this->invalid('currency_code', 'This is not a currency the platform recognises.');
        }

        return $code;
    }

    private function validatedScope(mixed $value): ?CustomerScope
    {
        return is_string($value) ? CustomerScope::tryFrom(trim($value)) : null;
    }

    /**
     * @throws ApiException
     */
    private function validatedBranchId(mixed $value, string $organisationId): ?string
    {
        $branchId = $this->trimmedOrNull(is_string($value) ? $value : null);

        if ($branchId === null) {
            return null;
        }

        $belongs = OrganisationBranch::withoutTenancy()
            ->whereKey($branchId)
            ->where('organisation_id', $organisationId)
            ->exists();

        if (! $belongs) {
            throw $this->invalid('branch_id', 'This branch does not exist, or is not one you can use.');
        }

        return $branchId;
    }

    /**
     * The list's own validity window, **inclusive at both ends** — see the
     * migration for why this differs from an entry's exclusive `effective_to`.
     *
     * @return array{valid_from: CarbonImmutable|null, valid_to: CarbonImmutable|null}
     *
     * @throws ApiException
     */
    private function validatedWindow(mixed $from, mixed $to): array
    {
        $validFrom = $this->dateOrNull($from, 'valid_from');
        $validTo = $this->dateOrNull($to, 'valid_to');

        if ($validFrom !== null && $validTo !== null && $validTo->lessThan($validFrom)) {
            throw $this->invalid('valid_to', 'A price list cannot stop being valid before it starts.');
        }

        return ['valid_from' => $validFrom, 'valid_to' => $validTo];
    }

    /**
     * @throws ApiException
     */
    private function dateOrNull(mixed $value, string $field): ?CarbonImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            throw $this->invalid($field, 'A date is written YYYY-MM-DD. A tariff runs "from Monday", not "from midnight in some timezone".');
        }

        return CarbonImmutable::createFromFormat('Y-m-d', $value)->startOfDay();
    }

    /**
     * @throws ApiException
     */
    private function requireOrganisation(): string
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        return $organisationId;
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
