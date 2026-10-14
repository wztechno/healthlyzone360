<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Nutrition;

use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

final class UsdaFoodDataProvider implements NutritionReferenceProvider
{
    private const string HOST = 'https://api.nal.usda.gov/fdc/v1';

    /** @return list<array{food: array<string, mixed>, retrieved_at: string}> */
    public function search(string $query): array
    {
        $query = trim($query);
        $key = $this->cacheKey('search:'.hash('sha256', mb_strtolower($query)));

        $records = Cache::remember($key, 86400, function () use ($query): array {
            $result = $this->request('POST', '/foods/search', [
                'query' => $query, 'dataType' => ['Foundation', 'SR Legacy', 'Branded'], 'pageSize' => 10,
            ]);
            $foods = $result['foods'] ?? null;
            if (! is_array($foods)) {
                throw new ProviderUnavailable;
            }
            $ids = [];
            foreach ($foods as $food) {
                if (is_array($food) && isset($food['fdcId']) && is_numeric($food['fdcId'])) {
                    $ids[] = (int) $food['fdcId'];
                }
            }
            if ($ids === []) {
                return [];
            }
            $details = $this->request('POST', '/foods', ['fdcIds' => array_slice($ids, 0, 10), 'format' => 'full']);
            $indexed = [];
            foreach ($details as $food) {
                if (is_array($food) && isset($food['fdcId']) && is_numeric($food['fdcId'])) {
                    $id = (string) $food['fdcId'];
                    $record = ['food' => $food, 'retrieved_at' => now()->toIso8601String()];
                    Cache::put($this->cacheKey('food:'.$id), $record, 2592000);
                    $indexed[$id] = $record;
                }
            }
            $records = [];
            foreach ($ids as $id) {
                if (isset($indexed[(string) $id])) {
                    $records[] = $indexed[(string) $id];
                }
            }
            if (count($records) !== count($ids)) {
                throw new ProviderUnavailable;
            }
            $priority = ['Foundation' => 0, 'SR Legacy' => 1, 'Branded' => 2];
            usort($records, static fn (array $a, array $b): int => ($priority[$a['food']['dataType'] ?? ''] ?? 3) <=> ($priority[$b['food']['dataType'] ?? ''] ?? 3));

            return $records;
        });

        // A fresh batch fetch may replace a detail snapshot before the query cache expires.
        // Always show the same latest snapshot that a subsequent resolve() will use.
        return array_map(function (array $record): array {
            $current = Cache::get($this->cacheKey('food:'.(string) $record['food']['fdcId']));
            if (is_array($current) && is_array($current['food'] ?? null) && is_string($current['retrieved_at'] ?? null)) {
                return ['food' => $current['food'], 'retrieved_at' => $current['retrieved_at']];
            }

            return $record;
        }, $records);
    }

    /** @return array{food: array<string, mixed>, retrieved_at: string} */
    public function fetch(string $id, bool $fresh = false): array
    {
        if (! preg_match('/^[0-9]+$/D', $id)) {
            throw new ReferenceUnsuitable(['Invalid USDA reference.']);
        }
        $key = $this->cacheKey('food:'.$id);
        $fetch = fn (): array => ['food' => $this->request('GET', '/food/'.$id), 'retrieved_at' => now()->toIso8601String()];
        if (! $fresh) {
            return Cache::remember($key, 2592000, $fetch);
        }
        $record = $fetch();
        Cache::put($key, $record, 2592000);

        return $record;
    }

    private function cacheKey(string $suffix): string
    {
        return 'nutrition:usda:'.NutritionReferenceService::MAPPING_VERSION.':'.$suffix;
    }

    private function reserveAttempt(): void
    {
        try {
            Cache::lock('nutrition:usda:quota-lock', 5)->block(3, function (): void {
                $now = now()->timestamp;
                $cooldown = Cache::get('nutrition:usda:cooldown', 0);
                $quota = Cache::get('nutrition:usda:quota', ['starts' => $now, 'count' => 0]);
                if (! is_array($quota) || $now >= ($quota['starts'] ?? 0) + 3600) {
                    $quota = ['starts' => $now, 'count' => 0];
                }
                $key = (string) config('services.usda_fdc.key', '');
                $budget = $key === 'DEMO_KEY' ? 25 : min(900, max(1, (int) config('services.usda_fdc.budget', 900)));
                $daily = Cache::get('nutrition:usda:demo-day', ['starts' => $now, 'count' => 0]);
                if (! is_array($daily) || $now >= ($daily['starts'] ?? 0) + 86400) {
                    $daily = ['starts' => $now, 'count' => 0];
                }
                if ($now < (int) $cooldown || $quota['count'] >= $budget || ($key === 'DEMO_KEY' && $daily['count'] >= 45)) {
                    throw new ProviderUnavailable;
                }
                $quota['count']++;
                Cache::put('nutrition:usda:quota', $quota, 3600);
                if ($key === 'DEMO_KEY') {
                    $daily['count']++;
                    Cache::put('nutrition:usda:demo-day', $daily, 86400);
                }
            });
        } catch (LockTimeoutException) {
            throw new ProviderUnavailable;
        }
    }

    /** @param array<string, mixed> $payload
     * @return array<array-key, mixed>
     */
    private function request(string $method, string $path, array $payload = []): array
    {
        $key = (string) config('services.usda_fdc.key', '');
        if ($key === '' || ($key === 'DEMO_KEY' && app()->isProduction())) {
            throw new ProviderUnavailable(configuration: true);
        }
        for ($attempt = 0; $attempt < 2; $attempt++) {
            $this->reserveAttempt();
            try {
                $response = Http::acceptJson()->withHeaders(['X-Api-Key' => $key])
                    ->connectTimeout(3)->timeout(10)->withoutRedirecting()
                    ->send($method, self::HOST.$path, $method === 'POST' ? ['json' => $payload] : []);
            } catch (ConnectionException) {
                if ($attempt === 0) {
                    usleep(200000);

                    continue;
                }
                throw new ProviderUnavailable;
            }
            if (in_array($response->status(), [401, 403], true)) {
                throw new ProviderUnavailable(configuration: true);
            }
            if ($response->status() === 429) {
                $retry = $response->header('Retry-After');
                $seconds = is_numeric($retry) ? (int) $retry : max(0, (strtotime($retry) ?: 0) - (int) now()->timestamp);
                try {
                    Cache::lock('nutrition:usda:quota-lock', 5)->block(3, function () use ($seconds): void {
                        $now = (int) now()->timestamp;
                        $until = max((int) Cache::get('nutrition:usda:cooldown', 0), $now + max(60, $seconds));
                        Cache::put('nutrition:usda:cooldown', $until, $until - $now);
                    });
                } catch (LockTimeoutException) {
                    throw new ProviderUnavailable;
                }
                throw new ProviderUnavailable;
            }
            if ($response->status() === 404) {
                throw new ReferenceUnsuitable(['The USDA reference was not found.']);
            }
            if ($response->serverError() && $attempt === 0) {
                usleep(200000);

                continue;
            }
            $body = $response->json();
            if (! $response->successful() || ! is_array($body)) {
                throw new ProviderUnavailable;
            }

            return $body;
        }
        throw new ProviderUnavailable;
    }
}
