<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Allergens;

use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

final class AllergenProviderHttp
{
    /** @param array<string, mixed> $query
     * @param  array<string, mixed>|null  $body
     * @return array<array-key, mixed>
     */
    public function request(string $provider, string $path, array $query = [], ?array $body = null, bool $search = false): array
    {
        $provider = 'open_food_facts';
        $host = 'https://world.openfoodfacts.org';
        $bucket = $provider.($search ? ':search' : ':read');
        try {
            Cache::lock('allergen-lookup:quota-lock', 5)->block(3, function () use ($bucket, $provider, $search): void {
                $now = (int) now()->timestamp;
                $stored = Cache::get('allergen-lookup:quota:'.$bucket, []);
                $quota = array_values(array_filter(is_array($stored) ? $stored : [], static fn (mixed $time): bool => is_int($time) && $time > $now - 60));
                $budget = ($search ? 8 : 12);
                if ((int) Cache::get('allergen-lookup:cooldown:'.$provider, 0) > $now || count($quota) >= $budget) {
                    throw new LookupFailure('throttled');
                }
                $quota[] = $now;
                Cache::put('allergen-lookup:quota:'.$bucket, $quota, 60);
            });
        } catch (LockTimeoutException) {
            throw new LookupFailure('throttled');
        }
        try {
            $options = ['query' => $query];
            if ($body !== null) {
                $options['json'] = $body;
            }
            $response = Http::acceptJson()->withUserAgent((string) config('services.open_food_facts.user_agent'))
                ->connectTimeout(3)->timeout(10)->withoutRedirecting()
                ->send($body === null ? 'GET' : 'POST', $host.$path, $options);
        } catch (ConnectionException) {
            // Keep transport internals out of public errors.
            throw new LookupFailure;
        }
        if (in_array($response->status(), [401, 403], true)) {
            throw new LookupFailure('configuration');
        }
        if ($response->status() === 429) {
            $retry = $response->header('Retry-After');
            $delay = is_numeric($retry) ? (int) $retry : max(0, (strtotime($retry) ?: 0) - (int) now()->timestamp);
            try {
                Cache::lock('allergen-lookup:quota-lock', 5)->block(3, function () use ($provider, $delay): void {
                    $now = (int) now()->timestamp;
                    $until = max((int) Cache::get('allergen-lookup:cooldown:'.$provider, 0), $now + max(60, $delay));
                    Cache::put('allergen-lookup:cooldown:'.$provider, $until, $until - $now);
                });
            } catch (LockTimeoutException) {
                throw new LookupFailure('throttled');
            }
            throw new LookupFailure('throttled');
        }
        if ($response->status() === 404) {
            return [];
        }
        $data = $response->json();
        if (! $response->successful() || ! is_array($data)) {
            throw new LookupFailure;
        }

        return $data;
    }
}
