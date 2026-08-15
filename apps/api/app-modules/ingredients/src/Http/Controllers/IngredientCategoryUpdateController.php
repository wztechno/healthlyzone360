<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Http\Requests\UpdateIngredientCategoryRequest;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/ingredient-categories/{category}.
 *
 * No `If-Match`: categories carry no `lock_version`, and the concurrency
 * contract applies only to resources that do (`docs/api/conventions.md`).
 * Sending a validator a resource cannot honour would be worse than sending
 * none.
 */
final class IngredientCategoryUpdateController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly IngredientCatalogueService $catalogue,
        private readonly TenantContext $context,
        private readonly IngredientPresenter $presenter,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateIngredientCategoryRequest $request, string $category): JsonResponse
    {
        $record = $this->locator->category($category);
        $this->catalogue->assertWritable($record);

        $changed = [];

        foreach (['name_en', 'name_ar', 'parent_id', 'display_order', 'is_active'] as $field) {
            if (! $request->has($field)) {
                continue;
            }

            $value = $request->validated($field);
            $record->setAttribute($field, is_string($value) ? trim($value) : $value);
            $changed[] = $field;
        }

        $record->save();

        $this->audit->record(
            'catalogue.ingredient_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient_category',
            subjectId: (string) $record->getKey(),
            metadata: ['category' => $record->code, 'changed_fields' => $changed],
        );

        return ApiResponse::data(['category' => $this->presenter->category($record)]);
    }
}
