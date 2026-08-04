<?php

declare(strict_types=1);

namespace Healthy360\KitchenDisplay\Http\Controllers;

use Healthy360\KitchenDisplay\Models\KitchenDisplayTicket;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

final class KdsTicketIndexController
{
    public function __invoke(): JsonResponse
    {
        $tickets = KitchenDisplayTicket::query()
            ->whereIn('status', ['new', 'preparing', 'ready'])
            ->orderBy('created_at')
            ->limit(100)
            ->get()
            ->map(fn (KitchenDisplayTicket $t): array => [
                'id' => (string) $t->getKey(),
                'label' => $t->label,
                'status' => $t->status,
                'station' => $t->station,
                'source_type' => $t->source_type,
                'source_id' => $t->source_id,
            ]);

        return ApiResponse::data(['tickets' => $tickets]);
    }
}
