<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Results;

use Healthy360\Customers\Closure\Enums\BlockerStatus;

/**
 * What one blocker found, in the four fields a closure screen needs and no
 * more.
 *
 * **`count` and `reason` are both present on every verdict, including the clear
 * ones.** A screen that renders "2 open orders" from `count` and "no
 * subscriptions module is bound" from `reason` is reading the same shape in
 * both cases, which is what stops the honest answer being the one that needs a
 * special case — and special-casing the honest answer is how it gets dropped.
 *
 * **`reason` is a code, never a sentence.** It is rendered by the client in the
 * customer's language and it goes into audit metadata, so prose here would be
 * an untranslatable string in a log. The vocabulary is each blocker's own and
 * is documented on the blocker.
 *
 * @see BlockerStatus for why `not_applicable` is not a kind of `clear`
 */
final readonly class BlockerVerdict
{
    private function __construct(
        public string $code,
        public BlockerStatus $status,
        public int $count,
        public ?string $reason,
    ) {}

    /**
     * Something real stands in the way.
     *
     * `$count` is required rather than defaulted: a blocking verdict that
     * cannot say how many of anything is one a customer cannot act on.
     */
    public static function blocking(string $code, int $count, string $reason): self
    {
        return new self($code, BlockerStatus::Blocking, $count, $reason);
    }

    /** Checked, and there is nothing here. */
    public static function clear(string $code): self
    {
        return new self($code, BlockerStatus::Clear, 0, null);
    }

    /**
     * Nothing was checked, and this is why.
     *
     * The reason is mandatory. A `not_applicable` without one is exactly the
     * unexplained shrug that reads as "fine" to everybody downstream.
     */
    public static function notApplicable(string $code, string $reason): self
    {
        return new self($code, BlockerStatus::NotApplicable, 0, $reason);
    }

    public function stopsClosure(): bool
    {
        return $this->status->stopsClosure();
    }

    /**
     * @return array{code: string, status: string, count: int, reason: string|null}
     */
    public function toArray(): array
    {
        return [
            'code' => $this->code,
            'status' => $this->status->value,
            'count' => $this->count,
            'reason' => $this->reason,
        ];
    }
}
