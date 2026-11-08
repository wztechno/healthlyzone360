<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Kitchens\Http\Requests\UpdateStorefrontProfileRequest;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET and PUT /api/v1/catalogue/storefront-profile — the copy a customer reads
 * on the kitchen's marketplace page: a tagline, a description and its cuisines,
 * in English and Arabic.
 *
 * The columns live on `organisations` so the anonymous marketplace reads them
 * from the row it already loads (`MarketplaceKitchenPresenter`). No `If-Match`,
 * for the reason the service settings give: the values arrive together and
 * there is no half of them for a validator to protect. Audited as the service
 * settings are, with each changed field's old and new value.
 */
final class StorefrontProfileController
{
    private const array FIELDS = ['tagline_en', 'tagline_ar', 'description_en', 'description_ar', 'cuisines_en', 'cuisines_ar'];

    public function __construct(
        private readonly TenantContext $context,
        private readonly AuditRecorder $audit,
    ) {}

    public function show(): JsonResponse
    {
        return ApiResponse::data(self::profile($this->organisation()));
    }

    public function update(UpdateStorefrontProfileRequest $request): JsonResponse
    {
        $organisation = $this->organisation();
        $validated = $request->validated();

        foreach (self::FIELDS as $field) {
            $value = $validated[$field];

            if (is_array($value)) {
                // Blank entries dropped, repeats folded, and an empty list stored as unset.
                $value = array_values(array_unique(array_filter(
                    array_map(static fn (?string $cuisine): string => trim((string) $cuisine), $value),
                    static fn (string $cuisine): bool => $cuisine !== '',
                )));
                $value = $value === [] ? null : $value;
            } elseif (is_string($value)) {
                $value = trim($value) === '' ? null : trim($value);
            }

            $organisation->setAttribute($field, $value);
        }

        $changed = array_keys($organisation->getDirty());
        // Flat `<field>_old` / `<field>_new` pairs: audit metadata holds scalars and lists only.
        $metadata = ['changed_fields' => $changed];

        foreach ($changed as $field) {
            $metadata["{$field}_old"] = self::auditValue($organisation->getOriginal($field));
            $metadata["{$field}_new"] = self::auditValue($organisation->getAttribute($field));
        }

        $organisation->save();

        $this->audit->record(
            'kitchen.storefront_profile_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'organisation',
            subjectId: (string) $organisation->getKey(),
            metadata: $metadata,
        );

        return ApiResponse::data(self::profile($organisation));
    }

    /**
     * A profile field as the audit stores it: text, a list of cuisines, or nothing.
     *
     * @return string|list<string>|null
     */
    private static function auditValue(mixed $value): string|array|null
    {
        if (is_array($value)) {
            return array_values(array_map(static fn (mixed $item): string => is_scalar($item) ? (string) $item : '', $value));
        }

        return is_scalar($value) ? (string) $value : null;
    }

    private function organisation(): Organisation
    {
        return Organisation::query()->findOrFail((string) $this->context->organisationId());
    }

    /**
     * Unset reads as `''` and `[]`, the shape the form edits.
     *
     * @return array{tagline_en: string, tagline_ar: string, description_en: string, description_ar: string, cuisines_en: list<string>, cuisines_ar: list<string>}
     */
    private static function profile(Organisation $organisation): array
    {
        return [
            'tagline_en' => $organisation->tagline_en ?? '',
            'tagline_ar' => $organisation->tagline_ar ?? '',
            'description_en' => $organisation->description_en ?? '',
            'description_ar' => $organisation->description_ar ?? '',
            'cuisines_en' => $organisation->cuisines_en ?? [],
            'cuisines_ar' => $organisation->cuisines_ar ?? [],
        ];
    }
}
