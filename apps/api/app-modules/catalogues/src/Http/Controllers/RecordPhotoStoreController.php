<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Enums\RecordPhotoSubject;
use Healthy360\Catalogues\Http\Requests\StoreRecordPhotoRequest;
use Healthy360\Catalogues\Services\RecordPhotoOwnership;
use Healthy360\Catalogues\Services\RecordPhotoService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * POST /api/v1/catalogue/{ingredients|recipes|items}/{id}/photo — set a record's photo (BUG-14).
 *
 * POST rather than PUT because PHP parses a multipart body only on POST.
 *
 * The subject comes from the route (`->defaults('subject', …)`), so one controller serves the three
 * routes while each keeps the permission its record is written under. A record outside this
 * organisation — another kitchen's, or a platform ingredient — is a 404.
 */
final class RecordPhotoStoreController
{
    public function __construct(
        private readonly RecordPhotoService $photos,
        private readonly RecordPhotoOwnership $ownership,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(StoreRecordPhotoRequest $request): JsonResponse
    {
        // By name: the route's default (`subject`) and its path parameter (`record`).
        $type = RecordPhotoSubject::from((string) $request->route('subject'));
        $record = (string) $request->route('record');
        $this->ownership->assertOwned($type, $record);

        $photo = $this->photos->store($type, $record, $request->photo());

        return ApiResponse::data(['photo' => ['id' => (string) $photo->getKey(), 'url' => $this->photos->link($photo)]]);
    }
}
