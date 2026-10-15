<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Http\Controllers;

use Healthy360\Ingredients\Allergens\AllergenReferenceService;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class AllergenReferenceSearchController
{
    public function __invoke(Request $request, AllergenReferenceService $references): JsonResponse
    {
        $input = $request->validate([
            'q' => ['required_without:barcode', 'nullable', 'string', 'min:2', 'max:150'],
            'barcode' => ['nullable', 'string', 'regex:/^[0-9]{8,14}$/D'],
        ]);

        return ApiResponse::data($references->search($input['q'] ?? '', $input['barcode'] ?? null))->header('Cache-Control', 'no-store, private');
    }
}
