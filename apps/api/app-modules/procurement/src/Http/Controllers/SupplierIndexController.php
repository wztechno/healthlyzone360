<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Procurement\Models\Supplier;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

final class SupplierIndexController
{
    public function __invoke(): JsonResponse
    {
        $suppliers = Supplier::query()->orderBy('code')->get()->map(fn (Supplier $s): array => [
            'id' => (string) $s->getKey(),
            'code' => $s->code,
            'name_en' => $s->name_en,
            'currency_code' => $s->currency_code,
            'contact_email' => $s->contact_email,
            'contact_phone' => $s->contact_phone,
        ]);

        return ApiResponse::data(['suppliers' => $suppliers]);
    }
}
