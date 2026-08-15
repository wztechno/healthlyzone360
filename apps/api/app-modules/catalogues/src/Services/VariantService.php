<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\PackFormat;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The variants of one item, replaced as a set.
 *
 * **Why set-replace, and why by `code`.** The admin contract offers both
 * shapes: `UpdateProductRequest` embeds `packVariants` in the item update,
 * while plans get a dedicated `setPlanVariants(planId, {variants})` whose
 * `PlanVariantInput.id` is `null` for a row being added. This service mirrors
 * the *second* — the dedicated, lock-versioned setter — and applies it to both
 * kinds, because the embedded form makes "I did not touch the packs" and "I
 * deleted every pack" the same request, which on the thing a price points at
 * is not a difference to leave to a client's diligence. The divergence is
 * recorded in `docs/api/conventions.md`.
 *
 * Rows are matched by `code`, not by position and not by identifier. A code is
 * stable within the item and is what a price list will name; matching on it
 * means a submitted set keeps the identifiers a price already points at, and a
 * caller does not have to echo identifiers back to avoid destroying them. An
 * `id` may still be sent and is checked for agreement, so a client that holds
 * one cannot silently retarget it at a different code.
 *
 * **Absent codes are archived, not deleted.** The catalogue never loses a row
 * an order or a price snapshot might point at. Re-submitting an archived code
 * revives it, which is what "we sell the 1 kg jar again" means.
 *
 * `variant_type` is **derived** from the item type and never accepted from a
 * client (appendix C: derived values are never client-supplied). A meal has no
 * variants at all — it is sold as itself — so a submission against one is
 * refused rather than quietly storing rows nothing can price.
 */
final readonly class VariantService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
        private CatalogueItemService $items,
    ) {}

    /**
     * @param  list<array{code: string, id?: string|null, name_en?: string|null, name_ar?: string|null, is_default?: bool|null, status?: string|null, pack?: array<string, mixed>|null}>  $variants
     *
     * @throws ApiException
     */
    public function replace(CatalogueItem $item, array $variants, int $expectedLockVersion): CatalogueItem
    {
        $this->items->assertEditable($item);

        $variantType = $item->item_type->variantType();

        if ($variantType === null) {
            throw $this->invalid(
                'variants',
                'A meal is sold as itself and has no variants. Packs belong to products; configurations belong to subscription plans.',
            );
        }

        $prepared = $this->prepare($item, $variants, $variantType);

        DB::transaction(function () use ($item, $prepared, $variantType, $expectedLockVersion): void {
            $this->items->compareAndSwap($item, ['updated_by' => $this->context->userId()], $expectedLockVersion);

            /** @var array<string, CatalogueItemVariant> $existing */
            $existing = CatalogueItemVariant::withoutTenancy()
                ->where('catalogue_item_id', $item->getKey())
                ->get()
                ->keyBy('code')
                ->all();

            $submitted = array_column($prepared, 'code');

            // Withdrawn first, and `is_default` cleared with them: the partial
            // unique index allows one default per item, so leaving a flag on an
            // archived row would block the incoming default.
            foreach ($existing as $code => $variant) {
                if (in_array($code, $submitted, true)) {
                    continue;
                }

                $variant->status = VariantStatus::Archived;
                $variant->is_default = false;
                $variant->updated_by = $this->context->userId();
                $variant->lock_version = $variant->lock_version + 1;
                $variant->save();
            }

            foreach ($prepared as $attributes) {
                $variant = $existing[$attributes['code']] ?? new CatalogueItemVariant;

                $variant->organisation_id = $item->organisation_id;
                $variant->catalogue_item_id = (string) $item->getKey();
                $variant->variant_type = $variantType;
                $variant->code = $attributes['code'];
                $variant->name_en = $attributes['name_en'];
                $variant->name_ar = $attributes['name_ar'];
                $variant->status = $attributes['status'];

                // Cleared on the way through so that two rows are never both
                // default mid-transaction; the winner is set below, once every
                // incumbent has been stood down.
                $variant->is_default = false;
                $variant->updated_by = $this->context->userId();

                if (! $variant->exists) {
                    $variant->created_by = $this->context->userId();
                    $variant->lock_version = 0;
                } else {
                    $variant->lock_version = $variant->lock_version + 1;
                }

                $variant->save();

                $this->writePack($variant, $attributes['pack'], $variantType);
            }

            $defaultCode = $this->defaultCodeOf($prepared);

            if ($defaultCode !== null) {
                CatalogueItemVariant::withoutTenancy()
                    ->where('catalogue_item_id', $item->getKey())
                    ->where('code', $defaultCode)
                    ->update(['is_default' => true]);
            }
        });

        $this->audit->record(
            'catalogue.item_variants_replaced',
            actorUserId: $this->context->userId(),
            subjectType: 'catalogue_item',
            subjectId: (string) $item->getKey(),
            metadata: [
                'changed_fields' => ['variants'],
                'variant_type' => $variantType->value,
                'variant_count' => count($prepared),
                'lock_version' => $item->lock_version,
            ],
        );

        return $item;
    }

    /**
     * Validate and normalise the submitted set.
     *
     * @param  list<array<string, mixed>>  $variants
     * @return list<array{code: string, name_en: string|null, name_ar: string|null, status: VariantStatus, is_default: bool, pack: array<string, mixed>|null}>
     *
     * @throws ApiException
     */
    private function prepare(CatalogueItem $item, array $variants, VariantType $variantType): array
    {
        $prepared = [];
        $seen = [];
        $defaults = 0;

        foreach ($variants as $index => $variant) {
            $code = trim((string) ($variant['code'] ?? ''));

            if ($code === '') {
                throw $this->invalid("variants.{$index}.code", 'A variant needs a code — it is what a price points at.');
            }

            if (in_array($code, $seen, true)) {
                throw $this->invalid("variants.{$index}.code", 'Two variants of one item cannot share a code.');
            }

            $seen[] = $code;

            $this->assertIdentifierAgrees($item, $variant, $code, $index);

            $status = VariantStatus::tryFrom((string) ($variant['status'] ?? VariantStatus::Active->value));

            if ($status === null) {
                throw $this->invalid("variants.{$index}.status", 'A variant is a draft, active or archived.');
            }

            $isDefault = (bool) ($variant['is_default'] ?? false);
            $defaults += $isDefault ? 1 : 0;

            $prepared[] = [
                'code' => $code,
                'name_en' => $this->trimmedOrNull(isset($variant['name_en']) ? (string) $variant['name_en'] : null),
                'name_ar' => $this->trimmedOrNull(isset($variant['name_ar']) ? (string) $variant['name_ar'] : null),
                'status' => $status,
                'is_default' => $isDefault,
                'pack' => $this->preparedPack($variant, $variantType, $index),
            ];
        }

        if ($defaults > 1) {
            throw $this->invalid('variants', 'Only one variant may be the default — a listing that has to pick one cannot toss a coin.');
        }

        return $prepared;
    }

    /**
     * Which code ends up flagged.
     *
     * When nobody marked one and the set is non-empty, the first submitted
     * variant wins. Deliberately not a refusal: the array order *is* the order
     * a kitchen typed them in, so "the first one" is both deterministic and
     * the answer a human would give. Two defaults is a different matter and is
     * refused, because there the caller has stated a contradiction.
     *
     * @param  list<array{code: string, is_default: bool, status: VariantStatus, name_en: string|null, name_ar: string|null, pack: array<string, mixed>|null}>  $prepared
     */
    private function defaultCodeOf(array $prepared): ?string
    {
        foreach ($prepared as $attributes) {
            if ($attributes['is_default']) {
                return $attributes['code'];
            }
        }

        return $prepared[0]['code'] ?? null;
    }

    /**
     * @param  array<string, mixed>  $variant
     *
     * @throws ApiException
     */
    private function assertIdentifierAgrees(CatalogueItem $item, array $variant, string $code, int $index): void
    {
        $id = isset($variant['id']) && is_string($variant['id']) ? trim($variant['id']) : '';

        if ($id === '') {
            return;
        }

        $existing = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->whereKey($id)
            ->first();

        if (! $existing instanceof CatalogueItemVariant) {
            throw $this->invalid("variants.{$index}.id", 'This variant does not belong to this item.');
        }

        if ($existing->code !== $code) {
            throw $this->invalid(
                "variants.{$index}.code",
                'A variant code is fixed. Submit the variant under its own code, or leave the identifier out to create a new one.',
            );
        }
    }

    /**
     * The pack half of one submitted variant.
     *
     * Required for a pack and refused for a plan configuration: a pack with no
     * size is not a pack, and a plan configuration has no size at all. Both are
     * validation failures rather than silent nulls, because a client that sent
     * either believed it was writing something.
     *
     * @param  array<string, mixed>  $variant
     * @return array<string, mixed>|null
     *
     * @throws ApiException
     */
    private function preparedPack(array $variant, VariantType $variantType, int $index): ?array
    {
        /** @var array<string, mixed>|null $pack */
        $pack = is_array($variant['pack'] ?? null) ? $variant['pack'] : null;

        if ($variantType === VariantType::PlanConfiguration) {
            if ($pack !== null) {
                throw $this->invalid("variants.{$index}.pack", 'A plan configuration is not sold in a pack.');
            }

            return null;
        }

        if ($pack === null) {
            throw $this->invalid("variants.{$index}.pack", 'A pack has to say how much is in it.');
        }

        $quantity = $pack['pack_quantity'] ?? null;

        if (! is_numeric($quantity) || (float) $quantity <= 0) {
            throw $this->invalid("variants.{$index}.pack.pack_quantity", 'A pack quantity must be a number greater than zero.');
        }

        $unitId = $this->trimmedOrNull(isset($pack['pack_unit_id']) ? (string) $pack['pack_unit_id'] : null);

        if ($unitId === null || ! MeasurementUnit::query()->whereKey($unitId)->exists()) {
            throw $this->invalid("variants.{$index}.pack.pack_unit_id", 'This measurement unit does not exist.');
        }

        $format = $this->trimmedOrNull(isset($pack['pack_format']) ? (string) $pack['pack_format'] : null);

        if ($format !== null && PackFormat::tryFrom($format) === null) {
            throw $this->invalid("variants.{$index}.pack.pack_format", 'This is not a pack format the platform recognises.');
        }

        return [
            'pack_quantity' => (string) $quantity,
            'pack_unit_id' => $unitId,
            'pack_piece_count' => $this->positiveIntOrNull($pack['pack_piece_count'] ?? null, "variants.{$index}.pack.pack_piece_count"),
            'pack_format' => $format,
            'net_weight_grams' => $this->positiveIntOrNull($pack['net_weight_grams'] ?? null, "variants.{$index}.pack.net_weight_grams"),
        ];
    }

    /**
     * @param  array<string, mixed>|null  $pack
     */
    private function writePack(CatalogueItemVariant $variant, ?array $pack, VariantType $variantType): void
    {
        if ($variantType !== VariantType::Pack || $pack === null) {
            return;
        }

        $row = CatalogueItemPackVariant::withoutTenancy()->whereKey($variant->getKey())->first() ?? new CatalogueItemPackVariant;

        $row->catalogue_item_variant_id = (string) $variant->getKey();
        $row->organisation_id = $variant->organisation_id;
        $row->pack_quantity = $pack['pack_quantity'];
        $row->pack_unit_id = $pack['pack_unit_id'];
        $row->pack_piece_count = $pack['pack_piece_count'];
        $row->pack_format = $pack['pack_format'];
        $row->net_weight_grams = $pack['net_weight_grams'];
        $row->save();
    }

    /**
     * @throws ApiException
     */
    private function positiveIntOrNull(mixed $value, string $field): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (! is_numeric($value) || (int) $value <= 0) {
            throw $this->invalid($field, 'This must be a whole number greater than zero.');
        }

        return (int) $value;
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
