<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Contracts;

/**
 * "Is this person the only one who can sign something a company is waiting on?"
 *
 * A corporate application in flight has a named signatory, and an agreement
 * sitting at `pending_signature` is a contract a whole organisation is waiting
 * for. Closing that person's identity underneath it does not just inconvenience
 * them: it strands the application with a signatory who no longer exists, and
 * nothing in the B2B module is watching for that. So closure asks first.
 *
 * **Declared here, implemented and bound by the B2B side** (B2, this wave), for
 * the same reason `SubscriptionPresence` is: closure must run in a deployment
 * without the module and must be able to say so rather than reporting "nothing
 * pending" when nothing looked. The null default answers `isAvailable() =
 * false` and the blocker reports `not_applicable` naming the absent module.
 *
 * **The question is asked about a `users` identifier, not a customer account.**
 * A signatory is a person with a login who signs on a company's behalf; they
 * frequently hold no customer account at all, and keying this on one would make
 * the blocker silently vacuous for precisely the people it protects.
 *
 * Coordination with the B2B agent is through this file and nothing else — it is
 * the whole of the contract, and neither module reads the other's tables.
 */
interface B2bSignatoryPresence
{
    /**
     * Whether a B2B module is bound and can answer.
     *
     * False is a fact about the deployment, never about the person.
     */
    public function isAvailable(): bool;

    /**
     * How many applications or agreements are waiting on this person's
     * signature.
     *
     * "Waiting" means the thing cannot proceed without them: an application in
     * a live review state naming them as applicant, or an agreement at
     * `pending_signature` against such an application. A signed agreement is
     * history and blocks nothing — the signature already happened, and the
     * evidence of it survives closure by design.
     *
     * @param  string  $userId  a `users` identifier
     */
    public function pendingSignatureCount(string $userId): int;
}
