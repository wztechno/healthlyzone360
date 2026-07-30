<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Tests\Fixtures;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;

/**
 * A queued job that reports what the database session looked like while it
 * was running, and how many organisation rows that session could see.
 *
 * The observations are static because the point of the test is that two jobs
 * processed by the *same* worker and the *same* connection each saw only
 * their own tenant. Anything instance-bound would prove nothing.
 */
final class RecordTenantSettingsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /**
     * @var list<array{label: string, user_id: string, organisation_id: string, branch_id: string, visible_branches: int}>
     */
    public static array $observed = [];

    public function __construct(private readonly string $label) {}

    public static function forget(): void
    {
        self::$observed = [];
    }

    public function handle(): void
    {
        /** @var object{user_id: string, organisation_id: string, branch_id: string, visible_branches: int} $row */
        $row = DB::selectOne(
            "select coalesce(current_setting('app.user_id', true), '') as user_id,
                    coalesce(current_setting('app.organisation_id', true), '') as organisation_id,
                    coalesce(current_setting('app.branch_id', true), '') as branch_id,
                    (select count(*) from organisation_branches) as visible_branches"
        );

        self::$observed[] = [
            'label' => $this->label,
            'user_id' => (string) $row->user_id,
            'organisation_id' => (string) $row->organisation_id,
            'branch_id' => (string) $row->branch_id,
            'visible_branches' => (int) $row->visible_branches,
        ];
    }
}
