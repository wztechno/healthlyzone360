<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Ingredients\Http\Requests\StoreIngredientCategoryRequest;
use Healthy360\Ingredients\Models\IngredientCategory;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/ingredient-categories.
 *
 * The uniqueness check runs against everything the caller can see — its own
 * rows and the platform library — rather than only its own: a tenant code
 * that shadows a platform code would make every later "which category is
 * this?" ambiguous, in the UI and in an import alike.
 */
final class IngredientCategoryStoreController
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly IngredientPresenter $presenter,
        private readonly AuditRecorder $audit,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreIngredientCategoryRequest $request): JsonResponse
    {
        $code = (string) $request->validated('code');

        if (IngredientCategory::query()->where('code', $code)->exists()) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'A category with this code is already visible in this organisation.',
                ['category' => $code],
            );
        }

        $nameEn = trim((string) $request->validated('name_en'));
        $nameAr = $request->validated('name_ar');

        $category = new IngredientCategory;
        $category->code = $code;
        $category->name_en = $nameEn;
        $category->name_ar = is_string($nameAr) && trim($nameAr) !== '' ? trim($nameAr) : $nameEn;
        $category->parent_id = $request->validated('parent_id');
        $category->display_order = (int) ($request->validated('display_order') ?? 0);
        $category->is_active = true;
        $category->created_by = $this->context->userId();
        $category->save();

        $this->audit->record(
            'catalogue.ingredient_created',
            actorUserId: $this->context->userId(),
            subjectType: 'ingredient_category',
            subjectId: (string) $category->getKey(),
            metadata: ['category' => $category->code],
        );

        return ApiResponse::data(['category' => $this->presenter->category($category)], status: 201);
    }
}
