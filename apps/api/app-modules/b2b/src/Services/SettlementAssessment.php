<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

/**
 * Every settlement check, run together.
 *
 * A collection rather than a boolean, and the reason is the same one the
 * account-activation evaluator gives: an offboarding that revealed one blocker
 * per attempt would turn a wind-up into five round trips, and the person
 * running it is looking at the list precisely because they want to know what
 * is left.
 *
 * `isClear()` is true when nothing **blocks** — an outcome of `not_applicable`
 * does not block, because a check that had nowhere to look cannot hold up a
 * relationship that is ending. The absence is still in `toArray()`, so the
 * summary stored on the row says what was skipped and why.
 */
final readonly class SettlementAssessment
{
    /**
     * @param  list<SettlementCheck>  $checks
     */
    public function __construct(public array $checks) {}

    public function isClear(): bool
    {
        return $this->blockers() === [];
    }

    /**
     * @return list<SettlementCheck>
     */
    public function blockers(): array
    {
        return array_values(array_filter($this->checks, static fn (SettlementCheck $check): bool => $check->blocks()));
    }

    /**
     * The names of the checks that are holding this up.
     *
     * @return list<string>
     */
    public function blockerNames(): array
    {
        return array_map(static fn (SettlementCheck $check): string => $check->name, $this->blockers());
    }

    /**
     * The checks that could not run, named with their reasons.
     *
     * Surfaced separately from the blockers because they are the honest part:
     * a caller rendering a settlement summary must be able to say "these three
     * were not checked, because the module does not exist" rather than letting
     * their absence read as a pass.
     *
     * @return list<string>
     */
    public function unavailableReasons(): array
    {
        $reasons = [];

        foreach ($this->checks as $check) {
            if ($check->reason !== null) {
                $reasons[] = $check->name.':'.$check->reason;
            }
        }

        return $reasons;
    }

    /**
     * @return list<array{check: string, outcome: string, reason: string|null, detail: string|null}>
     */
    public function toArray(): array
    {
        return array_map(static fn (SettlementCheck $check): array => $check->toArray(), $this->checks);
    }
}
