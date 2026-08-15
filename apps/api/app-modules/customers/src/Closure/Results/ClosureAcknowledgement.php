<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Results;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Closure\Enums\ClosureRequestStatus;
use Healthy360\Customers\Closure\Enums\ClosureScope;
use Healthy360\Customers\Closure\Models\AccountClosureRequest;

/**
 * What the caller is told after asking to close, or after proving it.
 *
 * One shape for both scopes and every stage, because the screen behind it is
 * one screen: a marketing opt-out comes back already `completed` with no
 * verification pending, a full closure comes back `requested` with a masked
 * destination and a countdown, and a blocked one comes back `requested` with
 * the verdicts filled in. A client that had to branch on the response *type*
 * would be a client that renders the blocked case by accident.
 *
 * **The verdicts travel with the acknowledgement rather than behind a second
 * call.** "Why can I not close my account" is the only question a refusal
 * raises, and answering it in a separate request is how a screen ends up
 * saying "you cannot close your account" with no explanation while the second
 * call is in flight.
 *
 * `destinationMasked` is server-authored from the contact point, never echoed
 * from client input — the client is told where the code went, and is not in a
 * position to be told anything it could have made up.
 */
final readonly class ClosureAcknowledgement
{
    /**
     * @param  list<BlockerVerdict>  $blockers
     */
    public function __construct(
        public string $requestId,
        public ClosureScope $scope,
        public ClosureRequestStatus $status,
        public array $blockers,
        public bool $verificationRequired,
        public ?string $destinationMasked = null,
        public ?int $expiresInSeconds = null,
        public ?CarbonImmutable $scheduledFor = null,
    ) {}

    /**
     * @param  list<BlockerVerdict>  $blockers
     */
    public static function for(
        AccountClosureRequest $request,
        array $blockers,
        bool $verificationRequired,
        ?string $destinationMasked = null,
        ?int $expiresInSeconds = null,
    ): self {
        return new self(
            requestId: (string) $request->getKey(),
            scope: $request->scope,
            status: $request->status,
            blockers: $blockers,
            verificationRequired: $verificationRequired,
            destinationMasked: $destinationMasked,
            expiresInSeconds: $expiresInSeconds,
            scheduledFor: $request->scheduled_for,
        );
    }

    /**
     * Whether anything the registry found stops this closure.
     */
    public function isBlocked(): bool
    {
        foreach ($this->blockers as $verdict) {
            if ($verdict->stopsClosure()) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{
     *     request_id: string,
     *     scope: string,
     *     status: string,
     *     blocked: bool,
     *     blockers: list<array{code: string, status: string, count: int, reason: string|null}>,
     *     verification_required: bool,
     *     destination_masked: string|null,
     *     expires_in_seconds: int|null,
     *     scheduled_for: string|null
     * }
     */
    public function toArray(): array
    {
        return [
            'request_id' => $this->requestId,
            'scope' => $this->scope->value,
            'status' => $this->status->value,
            'blocked' => $this->isBlocked(),
            'blockers' => array_map(static fn (BlockerVerdict $verdict): array => $verdict->toArray(), $this->blockers),
            'verification_required' => $this->verificationRequired,
            'destination_masked' => $this->destinationMasked,
            'expires_in_seconds' => $this->expiresInSeconds,
            'scheduled_for' => $this->scheduledFor?->toIso8601String(),
        ];
    }
}
