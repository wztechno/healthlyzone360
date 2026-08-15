<?php

declare(strict_types=1);

namespace Healthy360\B2b\Services;

use Healthy360\B2b\Enums\SettlementOutcome;

/**
 * What one settlement check looked at, and what it found.
 *
 * The `reason` is required on a `not_applicable` and forbidden on the other
 * two, enforced by the named constructors rather than by a validator: a gap
 * that does not say why it is a gap is indistinguishable from an oversight,
 * and a `clear` carrying an explanation invites the reader to wonder what it
 * is explaining.
 *
 * `$name` is the check, not the module — `open_orders`, `outstanding_invoices`
 * — because the manifest is read by somebody asking what was verified, and
 * "we checked the invoicing module" answers a different question from "we
 * checked for outstanding invoices".
 */
final readonly class SettlementCheck
{
    private function __construct(
        public string $name,
        public SettlementOutcome $outcome,
        public ?string $reason = null,
        public ?string $detail = null,
    ) {}

    public static function clear(string $name, ?string $detail = null): self
    {
        return new self($name, SettlementOutcome::Clear, detail: $detail);
    }

    public static function outstanding(string $name, string $detail): self
    {
        return new self($name, SettlementOutcome::Outstanding, detail: $detail);
    }

    /**
     * Nothing to look at, and the reason it could not be looked at.
     *
     * `$reason` is a stable machine string — `invoicing_module_absent` — so a
     * later phase can find every check that was standing in for it. It
     * deliberately does not end in `_code`: the audit recorder redacts any
     * metadata key containing that substring, and a settlement summary whose
     * reasons all read `[redacted]` would be worse than none.
     */
    public static function notApplicable(string $name, string $reason, ?string $detail = null): self
    {
        return new self($name, SettlementOutcome::NotApplicable, reason: $reason, detail: $detail);
    }

    public function blocks(): bool
    {
        return $this->outcome->blocks();
    }

    /**
     * @return array{check: string, outcome: string, reason: string|null, detail: string|null}
     */
    public function toArray(): array
    {
        return [
            'check' => $this->name,
            'outcome' => $this->outcome->value,
            'reason' => $this->reason,
            'detail' => $this->detail,
        ];
    }
}
