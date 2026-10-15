<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Enums\RecordPhotoSubject;
use Healthy360\Catalogues\Services\RecordPhotoOwnership;
use Healthy360\Catalogues\Services\RecordPhotoService;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * DELETE /api/v1/catalogue/{ingredients|recipes|items}/{id}/photo — remove a record's photo, so it
 * shows its stock picture again (BUG-14). Removing a photo that is not there is still a 204.
 */
final class RecordPhotoDestroyController
{
    public function __construct(
        private readonly RecordPhotoService $photos,
        private readonly RecordPhotoOwnership $ownership,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): Response
    {
        // By name: the route's default (`subject`) and its path parameter (`record`).
        $type = RecordPhotoSubject::from((string) $request->route('subject'));
        $record = (string) $request->route('record');
        $this->ownership->assertOwned($type, $record);

        $this->photos->remove($type, $record);

        return response()->noContent();
    }
}
