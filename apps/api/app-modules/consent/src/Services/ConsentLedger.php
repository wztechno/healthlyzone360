<?php

declare(strict_types=1);

namespace Healthy360\Consent\Services;

use App\Models\User;
use Healthy360\Consent\Enums\ConsentStatus;
use Healthy360\Consent\Models\ConsentDefinition;
use Healthy360\Consent\Models\ConsentGrant;
use Illuminate\Support\Collection;

/**
 * Reads and writes a user's consent position against the current consent
 * catalogue.
 *
 * Grants are queried through withoutTenancy(): platform consents (terms,
 * privacy) carry a NULL organisation and must be visible with no tenant
 * context resolved, and every query here is already constrained to the
 * authenticated user's own rows — an explicit, auditable cross-tenant path
 * rather than an ambient one.
 */
final class ConsentLedger
{
    /**
     * The consents a person must accept to create an account. Contextual
     * consents (health-data processing and future organisation-specific
     * texts) are collected in the workflows that need them.
     *
     * @var list<string>
     */
    public const array REGISTRATION_CODES = ['consent.terms', 'consent.privacy'];

    /**
     * The newest active version of every consent definition, keyed by code.
     *
     * @return Collection<string, ConsentDefinition>
     */
    public function currentDefinitions(): Collection
    {
        return ConsentDefinition::query()
            ->where('is_active', true)
            ->orderBy('code')
            ->orderByDesc('version')
            ->get()
            ->groupBy('code')
            ->map(fn (Collection $versions): ConsentDefinition => $versions->first());
    }

    /**
     * Record acceptance of the given consent codes at their current version.
     * Re-granting an already-granted version is a no-op, so a retried
     * registration cannot duplicate the audit trail.
     *
     * @param  list<string>  $codes
     */
    public function grant(User $user, array $codes, string $channel): void
    {
        $definitions = $this->currentDefinitions();

        foreach ($codes as $code) {
            $definition = $definitions->get($code);

            if ($definition === null) {
                continue;
            }

            $alreadyGranted = ConsentGrant::withoutTenancy()
                ->where('user_id', $user->getKey())
                ->where('consent_definition_id', $definition->getKey())
                ->where('status', ConsentStatus::Granted)
                ->exists();

            if ($alreadyGranted) {
                continue;
            }

            ConsentGrant::withoutTenancy()->create([
                'user_id' => $user->getKey(),
                'consent_definition_id' => $definition->getKey(),
                'organisation_id' => null,
                'status' => ConsentStatus::Granted,
                'granted_at' => now(),
                'channel' => $channel,
            ]);
        }
    }

    /**
     * Active consent definitions the user has not granted at their current
     * version. Surfaced on /api/v1/me so a client can prompt for them.
     *
     * @return list<array{code: string, version: int, purpose: string}>
     */
    public function pendingFor(User $user): array
    {
        $grantedDefinitionIds = ConsentGrant::withoutTenancy()
            ->where('user_id', $user->getKey())
            ->where('status', ConsentStatus::Granted)
            ->pluck('consent_definition_id')
            ->all();

        return array_values($this->currentDefinitions()
            ->reject(fn (ConsentDefinition $definition): bool => in_array($definition->getKey(), $grantedDefinitionIds, true))
            ->map(fn (ConsentDefinition $definition): array => [
                'code' => $definition->code,
                'version' => $definition->version,
                'purpose' => $definition->purpose,
            ])
            ->all());
    }
}
