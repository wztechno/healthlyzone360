<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Http\Requests\UpdateIngredientRequest;
use Healthy360\Ingredients\Presenters\IngredientPresenter;
use Healthy360\Ingredients\Services\CatalogueLocator;
use Healthy360\Ingredients\Services\IngredientCatalogueService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Http\Middleware\RequirePrecondition;
use Illuminate\Http\JsonResponse;

/**
 * PATCH /api/v1/catalogue/ingredients/{ingredient} — behind `precondition`.
 *
 * By the time this runs, `If-Match` is guaranteed present (428 otherwise).
 * What is not guaranteed is that it is a *Healthy360* validator: a client may
 * send `If-Match: "abc"`, and that is a malformed request rather than a lost
 * race, so it is 400 rather than 409. Whether the validator is current is
 * decided at the service layer, inside the same statement as the write.
 */
final class IngredientUpdateController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly IngredientCatalogueService $catalogue,
        private readonly IngredientPresenter $presenter,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(UpdateIngredientRequest $request, string $ingredient): JsonResponse
    {
        $record = $this->locator->ingredient($ingredient);
        $this->catalogue->assertWritable($record);

        $expected = RequirePrecondition::lockVersion($request);

        if ($expected === null) {
            throw new ApiException(
                ErrorCode::RequestInvalid,
                'The If-Match header must carry the ETag this resource was last served with.',
                ['required_headers' => ['If-Match']],
            );
        }

        $updated = $this->catalogue->update($record, $request->validated(), $expected);
        $updated->load('defaultUnit');

        return ApiResponse::data(['ingredient' => $this->presenter->ingredient($updated)])
            ->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
