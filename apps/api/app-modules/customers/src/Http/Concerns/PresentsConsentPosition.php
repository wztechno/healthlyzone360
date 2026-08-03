<?php

declare(strict_types=1);

namespace Healthy360\Customers\Http\Concerns;

use App\Models\User;
use Healthy360\Consent\Models\ConsentDefinition;
use Healthy360\Consent\Services\ConsentLedger;
use Healthy360\Customers\Presenters\CustomerConsentPresenter;
use Illuminate\Http\Request;

/**
 * The consumer's consent position, built once and served by both endpoints that
 * answer with it.
 *
 * A grant and a read of the result are one round trip on the wire — the client
 * ticks boxes and the response is what it now holds — so `POST /me/consents`
 * returns exactly what `GET /me/consents` would. Two constructions of the same
 * list would be two places for the audience filter to be wrong, and an audience
 * filter that is wrong in one of them starts asking a kitchen's chef to confirm
 * they are old enough to order food.
 *
 * **The audience is `d2c`, and it is the same string the activation evaluator
 * reads.** It lives here rather than being passed in from each controller
 * because it is a property of the surface — these are the consumer
 * self-service endpoints — and not a decision any individual endpoint gets to
 * make.
 *
 * The services are passed as arguments rather than injected: a trait has no
 * constructor to promote them into, and reaching for the container inside a
 * shared method would hide dependencies the controllers already declare in the
 * open.
 */
trait PresentsConsentPosition
{
    /**
     * The consent audience these endpoints serve.
     */
    protected const string CONSENT_AUDIENCE = 'd2c';

    /**
     * Every text this person is asked to hold, with whether they hold it at its
     * current version.
     *
     * `pendingFor()` is the authority on "not held", so the granted set is
     * derived by subtraction from it rather than from "has this code ever been
     * granted". A grant is recorded against one version; when a text is
     * reissued the old grant stays true history and the new version is
     * outstanding again, and a status computed from the code alone would report
     * a person as having accepted words they have never seen.
     *
     * @return list<array{code: string, version: int, purpose: string, audience: string, is_required: bool, status: string, display_order: int}>
     */
    protected function consentPosition(
        User $user,
        ConsentLedger $consents,
        CustomerConsentPresenter $presenter,
    ): array {
        $pendingCodes = array_map(
            static fn (array $pending): string => $pending['code'],
            $consents->pendingFor($user, self::CONSENT_AUDIENCE),
        );

        return array_values($consents->currentDefinitions()
            ->filter(static fn (ConsentDefinition $definition): bool => $definition->audience === ConsentLedger::AUDIENCE_ALL
                || $definition->audience === self::CONSENT_AUDIENCE)
            ->sortBy([['display_order', 'asc'], ['code', 'asc']])
            ->map(fn (ConsentDefinition $definition): array => $presenter->consent(
                $definition,
                ! in_array($definition->code, $pendingCodes, true),
            ))
            ->values()
            ->all());
    }

    /**
     * The channel a consent was collected through, taken from the declared
     * client platform. Diagnostic only — it never influences authorisation, and
     * it is the same derivation registration performs so the two halves of a
     * person's consent history are described the same way.
     */
    protected function consentChannel(Request $request): string
    {
        $platform = strtolower((string) $request->header('X-Client-Platform'));

        return in_array($platform, ['ios', 'android'], true) ? $platform : 'web';
    }
}
