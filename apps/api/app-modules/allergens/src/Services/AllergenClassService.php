<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Services;

use Healthy360\Allergens\Models\Allergen;
use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/**
 * Platform governance of the allergen vocabulary (master plan v2 §4.6).
 *
 * What the platform owns: display names, Arabic, descriptions, market
 * applicability, thresholds, ordering, activation.
 *
 * What nobody owns: the `code`. It is a regulatory identity that a kitchen's
 * mappings, a customer's declarations and a frozen recipe label all point at,
 * so it is never renamed and never deleted — a class that should no longer be
 * offered is deactivated, which hides it from the public list while leaving
 * every historical reference intact and readable.
 */
final readonly class AllergenClassService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{
     *     code: string,
     *     name_en: string,
     *     name_ar: string,
     *     description_en?: string|null,
     *     description_ar?: string|null,
     *     regulatory_ref: string,
     *     is_eu_14: bool,
     *     is_us_big_9: bool,
     *     us_declaration_required?: bool,
     *     us_threshold_ppm?: int|null,
     *     display_order?: int|null
     * }  $attributes
     *
     * @throws ApiException
     */
    public function create(array $attributes): Allergen
    {
        $code = strtolower(trim($attributes['code']));

        if (Allergen::query()->whereKey($code)->exists()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'An allergen class with this code already exists.',
                ['allergen_class' => $code],
            );
        }

        $allergen = new Allergen;
        $allergen->code = $code;
        $this->fill($allergen, $attributes);
        $allergen->display_order = $attributes['display_order'] ?? ((int) Allergen::query()->max('display_order') + 1);
        $allergen->is_active = true;
        $allergen->save();

        $this->audit->record(
            'reference.allergen_class_created',
            actorUserId: $this->context->userId(),
            subjectType: 'allergen_class',
            subjectId: $allergen->code,
            metadata: ['allergen_classes' => [$allergen->code], 'regulatory_ref' => $allergen->regulatory_ref],
        );

        return $allergen;
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function update(Allergen $allergen, array $attributes): Allergen
    {
        // Belt and braces: the form request already rejects a `code` field.
        // A canonical identity is not the kind of thing to protect in one
        // place only.
        if (array_key_exists('code', $attributes) && strtolower(trim((string) $attributes['code'])) !== $allergen->code) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'An allergen class code is a regulatory identity and cannot be changed.',
                ['fields' => ['code' => ['The allergen class code cannot be changed.']]],
            );
        }

        $changed = [];

        foreach (['name_en', 'name_ar', 'description_en', 'description_ar', 'regulatory_ref', 'is_eu_14', 'is_us_big_9', 'us_declaration_required', 'us_threshold_ppm', 'display_order'] as $field) {
            if (! array_key_exists($field, $attributes)) {
                continue;
            }

            $value = $attributes[$field];

            if (is_string($value)) {
                $value = trim($value);

                if ($value === '' && str_starts_with($field, 'description_')) {
                    $value = null;
                }
            }

            $allergen->setAttribute($field, $value);
            $changed[] = $field;
        }

        $allergen->save();

        $this->audit->record(
            'reference.allergen_class_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'allergen_class',
            subjectId: $allergen->code,
            metadata: ['allergen_classes' => [$allergen->code], 'changed_fields' => $changed],
        );

        return $allergen;
    }

    /**
     * Withdraw a class from the public vocabulary. Deliberately not a delete:
     * every mapping, declaration and frozen label that points at this code
     * must keep resolving to a readable name.
     */
    public function deactivate(Allergen $allergen): Allergen
    {
        $allergen->is_active = false;
        $allergen->save();

        $this->audit->record(
            'reference.allergen_class_deactivated',
            actorUserId: $this->context->userId(),
            subjectType: 'allergen_class',
            subjectId: $allergen->code,
            metadata: ['allergen_classes' => [$allergen->code]],
        );

        return $allergen;
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function fill(Allergen $allergen, array $attributes): void
    {
        $allergen->name_en = trim((string) $attributes['name_en']);
        $allergen->name_ar = trim((string) $attributes['name_ar']);
        $allergen->description_en = $this->trimmedOrNull($attributes['description_en'] ?? null);
        $allergen->description_ar = $this->trimmedOrNull($attributes['description_ar'] ?? null);
        $allergen->regulatory_ref = trim((string) $attributes['regulatory_ref']);
        $allergen->is_eu_14 = (bool) $attributes['is_eu_14'];
        $allergen->is_us_big_9 = (bool) $attributes['is_us_big_9'];
        $allergen->us_declaration_required = (bool) ($attributes['us_declaration_required'] ?? false);
        $allergen->us_threshold_ppm = isset($attributes['us_threshold_ppm']) && is_numeric($attributes['us_threshold_ppm'])
            ? (int) $attributes['us_threshold_ppm']
            : null;
    }

    private function trimmedOrNull(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }
}
