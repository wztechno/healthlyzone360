<?php

declare(strict_types=1);

namespace Healthy360\KitchenDisplay\Http\Controllers;

use Healthy360\KitchenDisplay\Models\KitchenDisplayTicket;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

final class KdsTicketBumpController
{
    public function __invoke(string $ticket): JsonResponse
    {
        $record = KitchenDisplayTicket::query()->whereKey($ticket)->first();
        if ($record === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $record->status = 'bumped';
        $record->save();

        return ApiResponse::data(['ticket' => ['id' => (string) $record->getKey(), 'status' => $record->status]]);
    }
}
