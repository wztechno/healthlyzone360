<?php

declare(strict_types=1);

namespace Healthy360\Customers\Exceptions;

use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Support\Api\ApiError;
use Healthy360\Support\Api\Contracts\ProvidesApiError;
use Healthy360\Support\Api\ErrorCode;
use RuntimeException;

/**
 * A customer account was asked to move somewhere it cannot go.
 *
 * Stable reason strings rather than error codes, per the J1 convention: the
 * wire vocabulary belongs to the HTTP follow-up.
 */
final class AccountTransitionRejected extends RuntimeException implements ProvidesApiError
{
    /**
     * @param  array<string, scalar|list<string>>  $details
     */
    private function __construct(
        private readonly string $reason,
        string $message,
        private readonly array $details = [],
    ) {
        parent::__construct($message);
    }

    public static function illegal(CustomerAccountStatus $from, CustomerAccountStatus $to): self
    {
        return new self(
            'account.transition_not_allowed',
            "A {$from->value} account cannot become {$to->value}.",
            ['from' => $from->value, 'to' => $to->value],
        );
    }

    /**
     * Activation refused by the evaluator, with every unmet requirement.
     *
     * All of them, not the first: an account setup checklist that revealed one
     * missing item per attempt would turn a two-minute task into five round
     * trips, and the person is looking at a checklist precisely because they
     * want to know what is left.
     *
     * @param  list<string>  $reasons
     */
    public static function notReady(array $reasons): self
    {
        return new self(
            'account.activation_requirements_unmet',
            'This account is not ready to be activated.',
            ['reasons' => $reasons],
        );
    }

    public function reason(): string
    {
        return $this->reason;
    }

    /**
     * @return array<string, scalar|list<string>>
     */
    public function details(): array
    {
        return $this->details;
    }

    /**
     * An unmet activation requirement is a 403 rather than a 409: nothing
     * conflicts, the person simply has steps left, and `details.outstanding`
     * names them so a client can send them to the right one instead of saying
     * "something is wrong with your account".
     */
    public function toApiError(): ApiError
    {
        if ($this->reason === 'account.activation_requirements_unmet') {
            return ApiError::make(
                ErrorCode::AccountVerificationRequired,
                $this->getMessage(),
                ['outstanding' => $this->details['reasons'] ?? []],
            );
        }

        return ApiError::make(ErrorCode::ResourceConflict, $this->getMessage(), ['reason' => $this->reason] + $this->details);
    }
}
