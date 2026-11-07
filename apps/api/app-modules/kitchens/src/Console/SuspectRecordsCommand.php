<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Lists records that look like test data a customer could see, for the owner to
 * review: kitchens, live catalogue items and people.
 *
 * **Read-only, always.** It only selects, there is no `--apply`, and what to do
 * with a row is a person's call: a name matching "test" may be a real dish. So it
 * takes no allowlist and is safe on any environment.
 *
 * Each kitchen is read in its own context, because row-level security hides the
 * rest. People are the members of that kitchen, so a tester who belongs to no
 * kitchen does not show here.
 *
 * ponytail: a fixed word list, so a plausible fake name is only found by being
 * named in it, as "amela harrington" is. Add the next one when it turns up.
 */
final class SuspectRecordsCommand extends Command
{
    use RunsInsideOneKitchen;

    /** Whole words only, so "Contest" and "Tempura" stay out. Read by PHP and by Postgres. */
    private const string SUSPECT_WORDS = '(^|[^[:alnum:]])(qa|e2e|uat|test|testing|tester|demo|sample|dummy|fake|placeholder|lorem|asdf|tmp|amela harrington)([^[:alnum:]]|$)';

    private const string SUSPECT_EMAIL = '(@example\.(com|org|net)|\.test)$';

    protected $signature = 'kitchen:suspect-records
        {--org= : One kitchen by slug. Without it, every organisation.}
        {--same-arabic : Instead, the live items whose Arabic name is their English one.}';

    protected $description = 'List records that look like customer-visible test data (read-only).';

    public function handle(): int
    {
        $slug = $this->stringOption('org');

        $organisations = Organisation::query()
            ->when($slug !== null, static fn ($query) => $query->where('slug', $slug))
            ->orderBy('name')
            ->get();

        if ($slug !== null && $organisations->isEmpty()) {
            $this->components->error(sprintf('No organisation with the slug "%s" exists.', $slug));

            return self::FAILURE;
        }

        $rows = [];

        foreach ($organisations as $organisation) {
            $name = (string) $organisation->name;

            if ($this->option('same-arabic') === true) {
                array_push($rows, ...$this->insideOrganisation($organisation, fn (string $organisationId): array => $this->untranslated($organisationId, $name)));

                continue;
            }

            if (preg_match('/'.self::SUSPECT_WORDS.'/iu', $name) === 1) {
                $rows[] = ['kitchen', (string) $organisation->getKey(), $name, $name, $organisation->status->value];
            }

            array_push($rows, ...$this->insideOrganisation(
                $organisation,
                fn (string $organisationId): array => [...$this->items($organisationId, $name), ...$this->people($organisationId, $name)],
            ));
        }

        if ($rows === []) {
            $this->components->info('Nothing looks like test data.');

            return self::SUCCESS;
        }

        $this->table(['Kind', 'Id', 'Kitchen', 'Name', 'Status'], $rows);
        $this->components->info(sprintf('%d to review. Nothing was changed.', count($rows)));

        return self::SUCCESS;
    }

    /**
     * A retired item is out of a customer's sight already.
     *
     * @return list<list<string>>
     */
    private function items(string $organisationId, string $kitchen): array
    {
        return $this->liveItems($organisationId, $kitchen, 'name_en ~* ?', [self::SUSPECT_WORDS]);
    }

    /**
     * Publication now refuses these, so a live one needs its Arabic written by a person.
     *
     * @return list<list<string>>
     */
    private function untranslated(string $organisationId, string $kitchen): array
    {
        return $this->liveItems($organisationId, $kitchen, 'trim(name_ar) = trim(name_en)', []);
    }

    /**
     * @param  literal-string  $condition
     * @param  list<string>  $bindings
     * @return list<list<string>>
     */
    private function liveItems(string $organisationId, string $kitchen, string $condition, array $bindings): array
    {
        return array_values(DB::table('catalogue_items')
            ->where('organisation_id', $organisationId)
            ->where('status', '!=', 'retired')
            ->whereRaw($condition, $bindings)
            ->orderBy('name_en')
            ->get(['id', 'item_type', 'name_en', 'status'])
            ->map(static fn (object $item): array => [(string) $item->item_type, (string) $item->id, $kitchen, (string) $item->name_en, (string) $item->status])
            ->all());
    }

    /**
     * @return list<list<string>>
     */
    private function people(string $organisationId, string $kitchen): array
    {
        return array_values(DB::table('organisation_memberships as m')
            ->join('users as u', 'u.id', '=', 'm.user_id')
            ->leftJoin('user_profiles as p', 'p.user_id', '=', 'u.id')
            ->where('m.organisation_id', $organisationId)
            ->where(static fn ($query) => $query
                ->whereRaw('u.email ~* ?', [self::SUSPECT_EMAIL])
                ->orWhereRaw("concat_ws(' ', p.given_name, p.family_name) ~* ?", [self::SUSPECT_WORDS]))
            ->orderBy('u.email')
            ->get(['u.id', 'p.given_name', 'p.family_name', 'u.email', 'm.status'])
            ->map(static fn (object $person): array => [
                'member',
                (string) $person->id,
                $kitchen,
                trim($person->given_name.' '.$person->family_name.' <'.$person->email.'>'),
                (string) $person->status,
            ])
            ->all());
    }
}
