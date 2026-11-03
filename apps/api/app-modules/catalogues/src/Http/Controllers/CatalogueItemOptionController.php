<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Services\CatalogueLocator;
use Healthy360\Catalogues\Services\DishOptions;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * GET and PUT /api/v1/catalogue/items/{item}/options: the free changes a dish
 * offers. A PUT of the whole list, as the item's variants are.
 *
 * The kitchen's own read, so it carries what a customer's does not: every choice,
 * linked or not, with its `recipe_id` and the linked recipe's published allergens.
 * A choice must name a recipe of this kitchen's (owner, 3 Nov 2026); one that does
 * not is refused `options.N.recipe_id` like any other missing field.
 */
final class CatalogueItemOptionController
{
    public function __construct(
        private readonly CatalogueLocator $locator,
        private readonly DishOptions $options,
        private readonly AuditRecorder $audit,
    ) {}

    public function index(string $item): JsonResponse
    {
        return ApiResponse::data(['options' => $this->options->forEditor($this->locator->item($item))]);
    }

    public function replace(Request $request, string $item): JsonResponse
    {
        $record = $this->locator->item($item);

        /** @var array{options: list<array{id?: string|null, kind: string, group_en?: string|null, group_ar?: string|null, name_en: string, name_ar: string, recipe_id?: string|null}>} $validated */
        $validated = $request->validate([
            'options' => ['present', 'array', 'max:40'],
            'options.*.id' => ['nullable', 'uuid'],
            'options.*.kind' => ['required', Rule::in(['remove', 'choice'])],
            'options.*.group_en' => ['nullable', 'required_if:options.*.kind,choice', 'string', 'max:80'],
            'options.*.group_ar' => ['nullable', 'string', 'max:80'],
            'options.*.name_en' => ['required', 'string', 'max:120'],
            'options.*.name_ar' => ['required', 'string', 'max:120'],
            'options.*.recipe_id' => [
                'nullable',
                'required_if:options.*.kind,choice',
                'uuid',
                Rule::exists('recipes', 'id')->where('organisation_id', (string) $record->organisation_id),
            ],
        ]);

        $options = $this->options->replace($record, $validated['options']);

        $this->audit->record('catalogue.item.options_replaced', (string) auth()->id(), 'catalogue_item', (string) $record->getKey(), [
            'option_count' => count($options),
        ]);

        return ApiResponse::data(['options' => $options]);
    }
}
