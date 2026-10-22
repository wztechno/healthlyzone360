<?php

declare(strict_types=1);

namespace Healthy360\Verification\Jobs;

use Healthy360\Verification\Enums\OtpChallengeStatus;
use Healthy360\Verification\Models\OtpChallenge;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Close what has expired, and delete what is finished with.
 *
 * Two steps, and the order is the point.
 *
 * **Close first.** Expiry is a moment, not an event: a row stays `pending`
 * past its window until something writes the transition. Leaving them that way
 * is not merely untidy — the partial unique index is built on `status =
 * 'pending'`, so an expired-but-open row keeps its slot and a person who waits
 * six minutes and asks for a new code collides with their own dead challenge.
 * The service supersedes on issue, which handles the common case; this handles
 * the rest.
 *
 * **Then delete, on `finished_at`, after a retention window.** A table of
 * verification attempts is exactly as sensitive as it sounds — who tried to
 * prove which contact, when, and how often — so it is not kept indefinitely
 * because it might be useful. Seven days
 * (`verification.otp.retain_finished_days`) is long enough to investigate an
 * abuse report and short enough that this never becomes an archive. The one
 * exception is a challenge another record still cites as signature evidence:
 * that is kept as long as the record is (see `citations()`).
 *
 * Hourly, `withoutOverlapping` and `onOneServer` (routes/console.php): the
 * deletes are chunked, so two workers running at once would do the same work
 * twice and interleave their chunks.
 */
final class PurgeExpiredOtpChallenges implements ShouldQueue
{
    use Queueable;

    /**
     * Rows deleted per statement. Bounded so one run cannot hold a long lock
     * on a table the login path writes to.
     */
    public const int CHUNK = 500;

    public function __construct()
    {
        $this->onQueue('maintenance');
    }

    public function handle(): void
    {
        $closed = OtpChallenge::query()
            ->where('status', OtpChallengeStatus::Pending)
            ->where('expires_at', '<', now())
            ->update([
                'status' => OtpChallengeStatus::Expired->value,
                'finished_at' => now(),
                'updated_at' => now(),
            ]);

        $cutoff = now()->subDays(max(1, (int) config('verification.otp.retain_finished_days', 7)));
        $deleted = 0;
        $citations = $this->citations();

        do {
            $batch = OtpChallenge::query()
                ->whereNotNull('finished_at')
                ->where('finished_at', '<', $cutoff)
                ->where(function (Builder $query) use ($citations): void {
                    foreach ($citations as $citation) {
                        $query->whereNotExists(fn (QueryBuilder $cited): QueryBuilder => $cited
                            ->selectRaw('1')
                            ->from($citation->referencing_table)
                            ->whereColumn("{$citation->referencing_table}.{$citation->referencing_column}", 'otp_challenges.id'));
                    }
                })
                ->limit(self::CHUNK)
                ->pluck('id')
                ->all();

            if ($batch === []) {
                break;
            }

            $deleted += OtpChallenge::query()->whereIn('id', $batch)->delete();
        } while (count($batch) === self::CHUNK);

        // Counts only. A purge that named the contacts it touched would
        // reconstruct in the log the very thing it deleted from the table.
        Log::info('Expired passcode challenges purged.', [
            'closed' => $closed,
            'deleted' => $deleted,
            'retain_days' => (int) config('verification.otp.retain_finished_days', 7),
        ]);
    }

    /**
     * Every column elsewhere that cites a challenge as evidence.
     *
     * Read from the catalogue rather than listed here, because the citing
     * tables belong to other modules: a signed B2B agreement and an offboarding
     * sign-off both point at the challenge that proved their signatory present,
     * `ON DELETE RESTRICT`, so the challenge lives as long as the record that
     * cites it. A third such column is honoured without touching this job.
     *
     * @return list<object{referencing_table: string, referencing_column: string}>
     */
    private function citations(): array
    {
        /** @var list<object{referencing_table: string, referencing_column: string}> */
        return DB::select(<<<'SQL'
            SELECT c.conrelid::regclass::text AS referencing_table, a.attname AS referencing_column
            FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
            WHERE c.contype = 'f' AND c.confrelid = 'otp_challenges'::regclass
            SQL);
    }
}
