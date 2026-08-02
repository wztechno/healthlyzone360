<?php

declare(strict_types=1);

namespace Healthy360\Consent\Services;

use App\Models\User;
use Healthy360\Consent\Enums\ConsentStatus;
use Healthy360\Consent\Models\ConsentDefinition;
use Healthy360\Consent\Models\ConsentGrant;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
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
 *
 * The consent_grants row-level security policies key on `app.user_id`
 * (plan §11), so writes declare the data subject to the database session for
 * their duration. Registration is why: the first grants a person makes are
 * written while nobody is authenticated yet, so there is no ambient identity
 * for the session to have inherited.
 */
final class ConsentLedger
{
    /**
     * The consents a person must accept to create an account. Contextual
     * consents (health-data processing and future organisation-specific
     * texts) are collected in the workflows that need them.
     *
     * Deliberately unchanged by J1. Registration is the moment an identity is
     * created, and it is the same moment for a kitchen's chef and a consumer;
     * the D2C set — age confirmation, health-data processing, marketing — is
     * collected by the onboarding journey that needs it, which is why those
     * definitions carry the `d2c` audience rather than joining this list.
     *
     * @var list<string>
     */
    public const array REGISTRATION_CODES = ['consent.terms', 'consent.privacy'];

    /** The audience every actor belongs to, whatever else they are. */
    public const string AUDIENCE_ALL = 'all';

    public function __construct(private readonly DatabaseTenantContext $session) {}

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

        $this->session->asUser((string) $user->getKey(), function () use ($definitions, $codes, $user, $channel): void {
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
        });
    }

    /**
     * Withdraw consent — a state transition, never a deletion.
     *
     * The grant row survives with `status = withdrawn` and a timestamp,
     * because "this person consented on the 3rd and withdrew on the 9th" is
     * the fact a regulator asks for, and a deleted row answers neither half of
     * it. The `consent_grants` policies enforce the same thing from
     * underneath: there is no DELETE policy at all, and the UPDATE policy is
     * keyed on `app.user_id`, so only the data subject can perform this.
     *
     * Which is why the write is wrapped in `asUser()`. Withdrawal frequently
     * runs somewhere the ambient context is not the subject — a closure job, a
     * support-initiated marketing opt-out — and without the declaration the
     * policy would match nothing and the update would silently affect zero
     * rows. Declaring the subject makes the RLS-safe path the only path.
     *
     * Withdrawing something never granted is a no-op rather than an error: the
     * caller's intent ("this person should not hold this consent") is
     * satisfied either way, and a marketing opt-out that threw for somebody
     * who never opted in would be an unpleasant surprise on a page nobody
     * should have to think about.
     *
     * @param  list<string>  $codes
     * @return int how many grants were withdrawn
     */
    public function withdraw(User $user, array $codes, string $channel): int
    {
        unset($channel);

        $definitionIds = ConsentDefinition::query()
            ->whereIn('code', $codes)
            ->pluck('id')
            ->all();

        if ($definitionIds === []) {
            return 0;
        }

        return $this->session->asUser((string) $user->getKey(), fn (): int => ConsentGrant::withoutTenancy()
            ->where('user_id', $user->getKey())
            ->whereIn('consent_definition_id', $definitionIds)
            ->where('status', ConsentStatus::Granted)
            ->update([
                'status' => ConsentStatus::Withdrawn->value,
                'withdrawn_at' => now(),
            ]));
    }

    /**
     * Active consent definitions the user has not granted at their current
     * version. Surfaced on /api/v1/me so a client can prompt for them.
     *
     * No session declaration here: this only ever runs for the authenticated
     * caller, whose identity db.context has already published, and declaring
     * it again would drop the organisation setting for the duration.
     *
     * **The audience filter** (J1). Passing an audience narrows the result to
     * the texts written for it plus the `all` texts everybody accepts. Without
     * it, the consumer set introduced in J1 would start prompting a kitchen's
     * chef to confirm they are old enough to order food. The parameter is
     * optional and defaults to no filtering, so the existing `/me` caller
     * keeps its behaviour exactly.
     *
     * @return list<array{code: string, version: int, purpose: string, audience: string, is_required: bool}>
     */
    public function pendingFor(User $user, ?string $audience = null): array
    {
        $grantedDefinitionIds = ConsentGrant::withoutTenancy()
            ->where('user_id', $user->getKey())
            ->where('status', ConsentStatus::Granted)
            ->pluck('consent_definition_id')
            ->all();

        return array_values($this->currentDefinitions()
            ->reject(fn (ConsentDefinition $definition): bool => in_array($definition->getKey(), $grantedDefinitionIds, true))
            ->filter(fn (ConsentDefinition $definition): bool => $this->appliesTo($definition, $audience))
            ->map(fn (ConsentDefinition $definition): array => [
                'code' => $definition->code,
                'version' => $definition->version,
                'purpose' => $definition->purpose,
                'audience' => $definition->audience,
                'is_required' => $definition->is_required,
            ])
            ->all());
    }

    /**
     * The codes an audience must hold before a lifecycle gate opens.
     *
     * Read by the customer activation evaluator, so "which consents block
     * activation" is answered by the consent catalogue rather than by a list
     * hard-coded in another module — a new required text takes effect by being
     * seeded, not by an edit somewhere else.
     *
     * @return list<string>
     */
    public function requiredCodesFor(string $audience): array
    {
        return array_values($this->currentDefinitions()
            ->filter(fn (ConsentDefinition $definition): bool => $definition->is_required && $this->appliesTo($definition, $audience))
            ->map(fn (ConsentDefinition $definition): string => $definition->code)
            ->values()
            ->all());
    }

    /**
     * The codes this person currently holds, at any version.
     *
     * @return list<string>
     */
    public function grantedCodesFor(User $user): array
    {
        $grantedDefinitionIds = ConsentGrant::withoutTenancy()
            ->where('user_id', $user->getKey())
            ->where('status', ConsentStatus::Granted)
            ->pluck('consent_definition_id')
            ->all();

        return array_values(ConsentDefinition::query()
            ->whereIn('id', $grantedDefinitionIds)
            ->pluck('code')
            ->unique()
            ->values()
            ->all());
    }

    private function appliesTo(ConsentDefinition $definition, ?string $audience): bool
    {
        if ($audience === null) {
            return true;
        }

        return $definition->audience === self::AUDIENCE_ALL || $definition->audience === $audience;
    }
}
