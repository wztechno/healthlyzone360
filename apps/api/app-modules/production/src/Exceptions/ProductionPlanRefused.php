<?php

declare(strict_types=1);

namespace Healthy360\Production\Exceptions;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * A batch cannot be planned or confirmed as asked (PROD1).
 *
 * Three reasons, each with its own remedy, which is why this is one code with a
 * stated reason rather than three codes or one bare message:
 *
 * - `no_output` — the recipe version does not say what it makes, so there is
 *   nothing to put on a shelf at the end.
 * - `multiple_outputs` — it says it makes two things, and splitting one batch's
 *   cost between them needs an allocation policy nobody has chosen (OQ-050).
 *   Refused rather than guessed: by mass, by value and by a stated ratio give
 *   materially different unit costs, and a made-up one would be a made-up margin.
 * - `plan_incomplete` — part of the formulation could not be turned into a
 *   quantity at all. `failures` names which ingredients and why, because "we
 *   could not work out what this batch needs" is only useful if it says which
 *   part.
 */
final class ProductionPlanRefused extends ApiException
{
    /**
     * @param  list<array{catalogue_item_id: string|null, reason_code: string, detail: string}>  $failures
     */
    public function __construct(string $reason, string $message, array $failures = [])
    {
        parent::__construct(
            ErrorCode::ProductionPlanRefused,
            $message,
            ['reason' => $reason] + ($failures === [] ? [] : ['failures' => $failures]),
        );
    }

    public static function noOutput(): self
    {
        return new self(
            'no_output',
            'This recipe version does not say what it produces, so a batch of it has nothing to put on a shelf.',
        );
    }

    public static function multipleOutputs(int $count): self
    {
        return new self(
            'multiple_outputs',
            'This recipe version produces '.$count.' things, and how a batch cost divides between them has not been decided. Produce them from separate versions for now.',
        );
    }

    /**
     * @param  list<array{catalogue_item_id: string|null, reason_code: string, detail: string}>  $failures
     */
    public static function planIncomplete(array $failures): self
    {
        return new self(
            'plan_incomplete',
            'Part of this recipe could not be turned into a quantity, so the batch cannot be confirmed against it.',
            $failures,
        );
    }
}
