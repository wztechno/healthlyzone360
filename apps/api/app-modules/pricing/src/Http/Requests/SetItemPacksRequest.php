<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The whole Packs & prices statement: the three places, and every pack the
 * item sells with its fill, packaging and two prices. Nothing is optional —
 * a pack left out is archived, so a partial body would be a destructive one.
 */
class SetItemPacksRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'places' => ['required', 'array:home,business,counter'],
            'places.home' => ['required', 'boolean'],
            'places.business' => ['required', 'boolean'],
            'places.counter' => ['required', 'boolean'],
            'packs' => ['present', 'array', 'max:50'],
            'packs.*' => ['array:id,fill,components,prices'],
            'packs.*.id' => ['nullable', 'uuid'],
            'packs.*.fill' => ['required', 'array:quantity,unit'],
            'packs.*.fill.quantity' => ['required', 'numeric', 'gt:0', 'max:99999999.9999'],
            'packs.*.fill.unit' => ['required', 'string', 'max:20'],
            'packs.*.components' => ['present', 'array', 'max:20'],
            'packs.*.components.*' => ['array:ingredient_id,quantity,is_container'],
            'packs.*.components.*.ingredient_id' => ['required', 'uuid'],
            'packs.*.components.*.quantity' => ['required', 'numeric', 'gt:0', 'max:99999999.9999'],
            'packs.*.components.*.is_container' => ['required', 'boolean'],
            'packs.*.prices' => ['required', 'array:home,business'],
            'packs.*.prices.home' => ['present', 'nullable', 'integer', 'min:1', 'max:2147483647'],
            'packs.*.prices.business' => ['present', 'nullable', 'integer', 'min:1', 'max:2147483647'],
        ];
    }

    /**
     * Decimals at the columns' scale, so `0.5` and `"0.50"` are one fill.
     *
     * @return array{
     *     places: array{home: bool, business: bool, counter: bool},
     *     packs: list<array{
     *         id: string|null,
     *         fill: array{quantity: string, unit: string},
     *         components: list<array{ingredient_id: string, quantity: string, is_container: bool}>,
     *         prices: array{home: int|null, business: int|null},
     *     }>,
     * }
     */
    public function statement(): array
    {
        $packs = [];

        /** @var list<array{id?: string|null, fill: array{quantity: int|float|string, unit: string}, components: list<array{ingredient_id: string, quantity: int|float|string, is_container: bool|int|string}>, prices: array{home: int|string|null, business: int|string|null}}> $input */
        $input = $this->input('packs', []);

        foreach ($input as $pack) {
            $packs[] = [
                'id' => isset($pack['id']) ? (string) $pack['id'] : null,
                'fill' => [
                    'quantity' => number_format((float) $pack['fill']['quantity'], 4, '.', ''),
                    'unit' => trim((string) $pack['fill']['unit']),
                ],
                'components' => array_values(array_map(static fn (array $component): array => [
                    'ingredient_id' => (string) $component['ingredient_id'],
                    'quantity' => number_format((float) $component['quantity'], 4, '.', ''),
                    'is_container' => filter_var($component['is_container'], FILTER_VALIDATE_BOOLEAN),
                ], $pack['components'])),
                'prices' => [
                    'home' => $pack['prices']['home'] === null ? null : (int) $pack['prices']['home'],
                    'business' => $pack['prices']['business'] === null ? null : (int) $pack['prices']['business'],
                ],
            ];
        }

        return [
            'places' => [
                'home' => $this->boolean('places.home'),
                'business' => $this->boolean('places.business'),
                'counter' => $this->boolean('places.counter'),
            ],
            'packs' => $packs,
        ];
    }
}
