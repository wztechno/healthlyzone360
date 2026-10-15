<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Allergens;

final readonly class OpenFoodFactsAllergenProvider
{
    private const string FIELDS = 'code,product_name,brands,allergens_tags,traces_tags,last_modified_t';

    public function __construct(private AllergenProviderHttp $http) {}

    /** @return list<array<string, mixed>> */
    public function search(string $query, ?string $barcode): array
    {
        if ($barcode !== null) {
            $product = $this->fetch($barcode);

            return $product === null ? [] : [$product];
        }
        // OFF's documented full-text search endpoint; never search on keystrokes.
        $data = $this->http->request('open_food_facts', '/cgi/search.pl', [
            'search_terms' => $query, 'search_simple' => 1, 'action' => 'process', 'json' => 1,
            'page_size' => 5, 'fields' => self::FIELDS,
        ], search: true);
        if (! is_array($data['products'] ?? null)) {
            throw new LookupFailure;
        }

        return array_values(array_filter(array_slice($data['products'], 0, 5), 'is_array'));
    }

    /** @return array<string, mixed>|null */
    public function fetch(string $barcode): ?array
    {
        if (! preg_match('/^[0-9]{8,14}$/D', $barcode)) {
            return null;
        }
        $data = $this->http->request('open_food_facts', '/api/v3/product/'.$barcode, ['fields' => self::FIELDS]);
        if ($data === [] || ($data['status'] ?? null) === 0) {
            return null;
        }
        if (! is_array($data['product'] ?? null)) {
            throw new LookupFailure;
        }

        return $data['product'];
    }
}
