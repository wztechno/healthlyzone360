<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Allergens;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;
use JsonException;

final readonly class AllergenReferenceService
{
    public function __construct(private OpenFoodFactsAllergenProvider $off, private AllergenReferenceMapper $mapper, private TenantContext $context) {}

    /** @return array{candidates: list<array<string, mixed>>, notices: list<string>} */
    public function search(string $query, ?string $barcode): array
    {
        $candidates = [];
        $notices = [];
        try {
            foreach ($this->off->search($query, $barcode) as $record) {
                $candidates[] = $this->candidate('open_food_facts', $record);
            }
        } catch (LookupFailure $error) {
            $notices[] = 'open_food_facts.'.$error->reason;
        }

        return ['candidates' => $candidates, 'notices' => $notices];
    }

    /** @param array<string, mixed> $record
     * @return array<string, mixed>
     */
    private function candidate(string $provider, array $record): array
    {
        $candidate = $this->mapper->map($provider, $record);
        if ($candidate['importable']) {
            $candidate['selection_token'] = Crypt::encryptString(json_encode([
                'organisation' => $this->context->organisationId(), 'user' => $this->context->userId(),
                'expires' => (int) now()->timestamp + 1800, 'candidate' => $candidate, 'version' => 1,
            ], JSON_THROW_ON_ERROR));
        }

        return $candidate;
    }

    /** @return array<string, mixed> */
    public function resolve(string $token): array
    {
        try {
            $payload = json_decode(Crypt::decryptString($token), true, flags: JSON_THROW_ON_ERROR);
        } catch (DecryptException|JsonException) {
            $payload = null;
        }
        if (! is_array($payload) || ($payload['version'] ?? null) !== 1 || ($payload['organisation'] ?? null) !== $this->context->organisationId() || ($payload['user'] ?? null) !== $this->context->userId() || ($payload['expires'] ?? 0) <= now()->timestamp || ! is_array($payload['candidate'] ?? null)) {
            throw new ApiException(ErrorCode::ValidationFailed, 'Search again and review a current allergen reference.');
        }
        $candidate = $payload['candidate'];
        if (($candidate['provider'] ?? '') !== 'open_food_facts') {
            throw new ApiException(ErrorCode::ValidationFailed, 'Search again and review a current allergen reference.');
        }
        try {
            $record = $this->off->fetch(substr((string) $candidate['ref'], 4));
        } catch (LookupFailure) {
            throw new ApiException(ErrorCode::AllergenProviderUnavailable, details: ['retryable' => true]);
        }
        if ($record === null) {
            throw new ApiException(ErrorCode::ValidationFailed, 'This product reference is no longer available.');
        }
        $fresh = $this->mapper->map('open_food_facts', $record);
        if (! hash_equals((string) $candidate['source_hash'], (string) $fresh['source_hash'])) {
            throw new ApiException(ErrorCode::ResourceConflict, 'The product allergen information changed. Search and review it again.');
        }
        $candidate = $fresh;
        if (! ($candidate['importable'] ?? false)) {
            throw new ApiException(ErrorCode::ValidationFailed, 'This reference has no importable allergen suggestions.');
        }

        return $candidate;
    }
}
