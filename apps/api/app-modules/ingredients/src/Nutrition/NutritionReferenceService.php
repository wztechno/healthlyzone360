<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Nutrition;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

final readonly class NutritionReferenceService
{
    public const string MAPPING_VERSION = '1';

    public const array REQUIRED_NUTRIENTS = ['energy', 'protein', 'carbohydrate', 'fat', 'fibre', 'sugars', 'sodium'];

    private const string SELECT_AND_CONFIRM = 'Select a USDA reference and confirm its purchased preparation state.';

    private const array NUMBERS = [
        'energy' => ['208', '958', '957'], 'protein' => ['203'], 'carbohydrate' => ['205'],
        'fat' => ['204'], 'fibre' => ['291'], 'sugars' => ['269', '269.3'],
        'saturated_fat' => ['606'], 'sodium' => ['307'],
    ];

    public function __construct(private NutritionReferenceProvider $provider) {}

    /** @return list<array<string, mixed>> */
    public function search(string $query): array
    {
        return array_map(fn (array $record): array => $this->map($record)->candidate, $this->provider->search($query));
    }

    public function resolve(string $ref, string $hash, bool $confirmed, bool $fresh = false): NutritionReference
    {
        if (! $confirmed) {
            throw new ReferenceUnsuitable([self::SELECT_AND_CONFIRM]);
        }

        return $this->suggestion($ref, $hash, $fresh);
    }

    /**
     * The same checks as {@see resolve()} short of the cook's confirmation: a pick to show as a
     * suggestion, never figures to save.
     */
    public function suggestion(string $ref, string $hash, bool $fresh = false): NutritionReference
    {
        if (! preg_match('/^usda:([0-9]+)$/D', $ref, $matches)) {
            throw new ReferenceUnsuitable([self::SELECT_AND_CONFIRM]);
        }
        $reference = $this->map($this->provider->fetch($matches[1], $fresh));
        if ($reference->candidate['ref'] !== $ref) {
            throw new ReferenceUnsuitable(['The provider returned a different reference.']);
        }
        if (! hash_equals((string) $reference->candidate['source_hash'], $hash)) {
            throw new ApiException(ErrorCode::ResourceConflict, 'The reference changed. Search again and review the current figures.', ['fields' => ['nutrition_reference' => ['Review the changed reference before saving.']]]);
        }
        if (! $reference->candidate['suitable']) {
            throw new ReferenceUnsuitable($reference->candidate['reasons']);
        }

        return $reference;
    }

    /** @param array{food: array<string, mixed>, retrieved_at: string} $record */
    public function map(array $record): NutritionReference
    {
        $food = $record['food'];
        $snapshot = array_intersect_key($food, array_flip(['fdcId', 'description', 'brandOwner', 'brandName', 'dataType', 'servingSize', 'servingSizeUnit', 'publicationDate', 'foodNutrients']));
        $snapshot = self::canonical($snapshot);
        $numbers = [];
        foreach (is_array($food['foodNutrients'] ?? null) ? $food['foodNutrients'] : [] as $entry) {
            if (! is_array($entry) || ! is_array($entry['nutrient'] ?? null)) {
                continue;
            }
            $nutrient = $entry['nutrient'];
            $number = $nutrient['number'] ?? null;
            if (! is_numeric($number)) {
                continue;
            }
            $normal = rtrim(rtrim(number_format((float) $number, 3, '.', ''), '0'), '.');
            $numbers[$normal][] = ['value' => $entry['amount'] ?? null, 'unit' => strtolower((string) ($nutrient['unitName'] ?? ''))];
        }
        $amounts = [];
        $missing = [];
        $reasons = [];
        foreach (self::NUMBERS as $id => $variants) {
            $unit = $id === 'energy' ? 'kcal' : ($id === 'sodium' ? 'mg' : 'g');
            $found = null;
            foreach ($variants as $number) {
                $entries = $numbers[$number] ?? [];
                if ($entries === []) {
                    continue;
                }
                if (count($entries) !== 1 || $entries[0]['unit'] !== $unit || ! is_numeric($entries[0]['value']) || ! is_finite((float) $entries[0]['value']) || (float) $entries[0]['value'] < 0) {
                    $reasons[] = 'Invalid or ambiguous '.$id.' amount or unit.';
                    break;
                }
                $found = (float) $entries[0]['value'];
                break;
            }
            if ($found !== null) {
                $amounts[] = ['nutrient_id' => $id, 'value' => $found, 'unit' => $unit];
            } elseif (in_array($id, self::REQUIRED_NUTRIENTS, true)) {
                $missing[] = $id;
            }
        }
        $type = (string) ($food['dataType'] ?? '');
        if (! in_array($type, ['Foundation', 'SR Legacy', 'Branded'], true)) {
            $reasons[] = 'Unsupported USDA data type.';
        }
        $unsupportedBasis = $type === 'Branded' && strtolower((string) ($food['servingSizeUnit'] ?? '')) !== 'g';
        if ($unsupportedBasis) {
            $reasons[] = 'A confirmed gram basis is required; volume and unknown bases are unsupported.';
        }
        if ($missing !== []) {
            $reasons[] = 'Missing nutrients: '.implode(', ', $missing).'.';
        }
        if (! isset($food['fdcId']) || ! is_numeric($food['fdcId']) || trim((string) ($food['description'] ?? '')) === '') {
            $reasons[] = 'Missing source identity or description.';
        }
        $brand = trim((string) ($food['brandName'] ?? ''));
        if ($brand === '') {
            $brand = trim((string) ($food['brandOwner'] ?? ''));
        }

        return new NutritionReference([
            'ref' => 'usda:'.($food['fdcId'] ?? ''), 'provider' => 'usda',
            'label' => (string) ($food['description'] ?? ''), 'brand' => $brand === '' ? null : $brand,
            'data_type' => $type, 'nutrition_per_100g' => ['basis' => 'per_100g', 'amounts' => $amounts],
            'suitable' => $reasons === [], 'reasons' => $reasons, 'missing_nutrients' => $missing,
            // Structured beside `reasons`, which is English prose: a branded sauce is usually listed
            // per ml, and a row that only named its missing nutrients hid the bigger blocker.
            'unsupported_basis' => $unsupportedBasis,
            'source_hash' => hash('sha256', json_encode($snapshot, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION)),
            'retrieved_at' => $record['retrieved_at'],
        ], $snapshot);
    }

    /** @param array<array-key, mixed> $value
     * @return array<array-key, mixed>
     */
    public static function canonical(array $value): array
    {
        foreach ($value as &$entry) {
            if (is_array($entry)) {
                $entry = self::canonical($entry);
            }
        }
        unset($entry);
        if (array_is_list($value)) {
            usort($value, static fn (mixed $a, mixed $b): int => strcmp(json_encode($a, JSON_THROW_ON_ERROR), json_encode($b, JSON_THROW_ON_ERROR)));
        } else {
            ksort($value);
        }

        return $value;
    }
}
