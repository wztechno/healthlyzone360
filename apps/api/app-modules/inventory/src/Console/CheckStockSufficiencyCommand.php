<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Console;

use Carbon\CarbonImmutable;
use Healthy360\Inventory\Services\StockSufficiencyCheckRunner;
use Illuminate\Console\Command;

/**
 * The weekly stock check, by hand or from the scheduler: every branch that keeps
 * a shelf, the buy list for the days ahead, recorded as one row per branch.
 */
final class CheckStockSufficiencyCommand extends Command
{
    protected $signature = 'inventory:check-stock-sufficiency
        {--days=7 : How many days ahead to check, today included}';

    protected $description = 'Check every kitchen branch has the stock its upcoming orders need, and record what is short';

    public function handle(StockSufficiencyCheckRunner $runner): int
    {
        $days = (int) $this->option('days');
        $branches = $runner->run(CarbonImmutable::now(), $days > 0 ? $days : StockSufficiencyCheckRunner::WINDOW_DAYS);

        $this->components->info(sprintf('Checked %d branch(es).', $branches));

        return self::SUCCESS;
    }
}
