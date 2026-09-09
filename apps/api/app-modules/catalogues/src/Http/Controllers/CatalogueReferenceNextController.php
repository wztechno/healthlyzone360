<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Recipes\Services\RecipeService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/catalogue/references/next?prefix=ING- — the handle the next record
 * of this kind will take.
 *
 * ## Why a form needs to ask
 *
 * A reference is assigned on create, by the same scan that answers here, and a
 * create form draws it before there is a record to read it from. The only way
 * the number on that form can be the number the record gets is for both to come
 * from one implementation, which is what this endpoint exposes: it calls the
 * services' own `nextReferenceFor`, not a copy of the rule.
 *
 * ## It is a preview, not a reservation
 *
 * Two cooks opening a create form at the same moment both see `ING-307`; the
 * first to save takes it and the second saves at `ING-308`. That is the honest
 * behaviour of a series derived by scanning, and it is the one worth having: a
 * counter column handing out reservations would leave permanent holes wherever
 * a form was abandoned, in a sequence whose whole purpose is to be read down a
 * column and quoted out loud.
 *
 * So this answer is not a promise, and nothing downstream may treat it as one.
 * The record's own reference is whatever the create response carries back.
 *
 * ## Behind the read permission
 *
 * Knowing what the next handle will be is the same knowledge as reading the
 * last one off the list, which `catalogue.view_organisation` already grants.
 * It states no formulation, no cost and no name.
 */
final class CatalogueReferenceNextController
{
    /** The series the sellable catalogue owns, and how wide each one's number is. */
    private const array ITEM_SERIES = ['SAC-', 'DRS-'];

    public function __construct(
        private readonly TenantContext $context,
        private readonly IngredientCatalogueService $ingredients,
        private readonly RecipeService $recipes,
        private readonly CatalogueItemService $items,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse
    {
        $prefix = $request->query('prefix');

        if (! is_string($prefix) || $prefix === '') {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The prefix parameter names which series to read, e.g. ING-.',
                ['parameter' => 'prefix'],
            );
        }

        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'A reference series belongs to a kitchen, and this request names none.',
                ['parameter' => 'prefix'],
            );
        }

        // The series says which table holds it, and the answer is the table the
        // existing handles are actually in: `ING-` among the ingredients,
        // `RC-` among the recipes, and `SAC-`/`DRS-` among the catalogue items
        // — where the import wrote forty-three and nineteen of them. Reading a
        // sauce's series off the recipes table would hand out `SAC-001` to a
        // kitchen that has had one since the import.
        $reference = match (true) {
            $prefix === 'ING-' => $this->ingredients->nextReferenceFor($organisationId, $prefix),
            in_array($prefix, self::ITEM_SERIES, true) => $this->items->nextReferenceFor($organisationId, $prefix),
            in_array($prefix, RecipeService::REFERENCE_PREFIXES, true) => $this->recipes->nextReferenceFor($organisationId, $prefix),
            default => throw new ApiException(
                ErrorCode::RequestInvalid,
                'The prefix must be one of: ING-, '.implode(', ', [...self::ITEM_SERIES, ...RecipeService::REFERENCE_PREFIXES]).'.',
                ['parameter' => 'prefix'],
            ),
        };

        return ApiResponse::data(['reference' => $reference]);
    }
}
