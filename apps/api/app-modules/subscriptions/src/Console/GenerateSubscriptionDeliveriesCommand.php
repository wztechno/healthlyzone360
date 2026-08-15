<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Console;

use Healthy360\Subscriptions\Services\GenerationService;
use Illuminate\Console\Command;

/**
 * The generation tick, runnable by hand.
 *
 * The scheduled path is the queued job; this is the same service invoked
 * synchronously, for the two cases a queue is the wrong shape for: an operator
 * who needs to know *now* whether a kitchen's Tuesday orders came out, and a
 * developer standing a world up. It prints the tally the job logs.
 *
 * It deliberately does not take a subscription argument. Generation is a sweep
 * with a single ordering rule and a per-day claim; a "just this one" flag would
 * be a second entry point into the same invariants, and the first thing to
 * diverge would be the claim.
 */
final class GenerateSubscriptionDeliveriesCommand extends Command
{
    /** @var string */
    protected $signature = 'subscriptions:generate';

    /** @var string */
    protected $description = 'Generate the subscription deliveries whose change cut-off has passed.';

    public function handle(GenerationService $generation): int
    {
        $tally = $generation->tick();

        $this->components->info(sprintf(
            'Generated %d, skipped %d, completed %d, restored %d.',
            $tally['generated'],
            $tally['skipped'],
            $tally['completed'],
            $tally['reconciled'],
        ));

        return self::SUCCESS;
    }
}
