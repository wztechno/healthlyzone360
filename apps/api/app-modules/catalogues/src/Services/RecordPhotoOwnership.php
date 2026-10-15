<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Enums\RecordPhotoSubject;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/**
 * Whether a record may take a photo here: it exists and belongs to this organisation. A platform
 * ingredient is shared by every kitchen, so none of them may put a photo on it.
 */
final class RecordPhotoOwnership
{
    public function __construct(private readonly TenantContext $context) {}

    /**
     * @throws ApiException
     */
    public function assertOwned(RecordPhotoSubject $subject, string $recordId): void
    {
        $organisationId = $this->context->organisationId();

        $query = match ($subject) {
            RecordPhotoSubject::Ingredient => Ingredient::query(),
            RecordPhotoSubject::Recipe => Recipe::query(),
            RecordPhotoSubject::CatalogueItem => CatalogueItem::query(),
        };

        $owned = $organisationId !== null
            && $query->whereKey($recordId)->where('organisation_id', $organisationId)->exists();

        if (! $owned) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }
    }
}
