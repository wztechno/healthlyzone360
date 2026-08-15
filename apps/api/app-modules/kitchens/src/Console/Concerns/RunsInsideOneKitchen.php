<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console\Concerns;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\TenantContext;

/**
 * What the three DEC1 data commands share with the Healthy360 kitchen workbook importer beside
 * them: an environment allowlist, one organisation, and both halves of the
 * tenant context.
 *
 * **The allowlist is the authority.** These commands carry out decisions a
 * product owner signed off in a workbook — allergen determinations, approximate
 * plan prices, a publication run — and they carry them out with no
 * authenticated user, because there is no user: the operator is sitting at a
 * terminal with the source files on the same disk. That is precisely the
 * arrangement `kitchen:import-workbook` already makes, and reusing it is
 * deliberate. The control on these commands is `kitchens.import.environments`,
 * not the HTTP permission stack, and they say so out loud when they refuse.
 *
 * **Both halves of the context, always.** `DatabaseTenantContext` publishes the
 * session variables the row-level security policies read; `TenantContext` is
 * what the application services consult. Setting one and not the other is how a
 * query silently returns nothing, because the policies fail closed — and on a
 * command whose job is to count what it changed, an empty result set that
 * should not be empty is the worst possible failure mode.
 */
trait RunsInsideOneKitchen
{
    /**
     * Refuse, loudly and with the reason, outside the allowlisted environments.
     */
    protected function refusesThisEnvironment(string $command): bool
    {
        $allowed = $this->allowedEnvironments();
        $environment = (string) $this->laravel->environment();

        if (in_array($environment, $allowed, true)) {
            return false;
        }

        $this->components->error(sprintf('%s refuses to run in the "%s" environment.', $command, $environment));
        $this->line('');
        $this->line('  This command writes food-safety determinations, prices or publication states into one');
        $this->line('  organisation with no authenticated user behind it. It is allowlisted to: '.implode(', ', $allowed).'.');
        $this->line('');
        $this->line('  Widen kitchens.import.environments (or KITCHEN_WORKBOOK_IMPORT_ENVIRONMENTS) deliberately, with a');
        $this->line('  reviewer, if this is genuinely the right place to run it.');

        return true;
    }

    /**
     * The organisation named by `--org`, or the configured Healthy360 slug.
     */
    protected function resolveOrganisation(): ?Organisation
    {
        $slug = $this->stringOption('org') ?? (string) config('kitchens.import.organisation_slug', 'healthy360-kitchen');

        $organisation = Organisation::query()->where('slug', $slug)->first();

        if (! $organisation instanceof Organisation) {
            $this->components->error(sprintf('No organisation with the slug "%s" exists.', $slug));
            $this->line('  Run kitchen:import-workbook first, or name a different organisation with --org.');

            return null;
        }

        return $organisation;
    }

    /**
     * Run a callback with this organisation established in both contexts.
     */
    protected function insideOrganisation(Organisation $organisation, callable $callback): mixed
    {
        /** @var TenantContext $context */
        $context = $this->laravel->make(TenantContext::class);

        /** @var DatabaseTenantContext $database */
        $database = $this->laravel->make(DatabaseTenantContext::class);

        $organisationId = (string) $organisation->getKey();
        $ambient = $context->toArray();

        try {
            return $database->during(null, $organisationId, null, function () use ($context, $organisationId, $callback): mixed {
                $context->restore(['user_id' => null, 'organisation_id' => $organisationId, 'branch_id' => null]);

                return $callback($organisationId);
            });
        } finally {
            $context->restore($ambient);
        }
    }

    protected function section(string $title): void
    {
        $this->line('');
        $this->line('── '.$title.' '.str_repeat('─', max(3, 72 - mb_strlen($title))));
    }

    /**
     * @return list<string>
     */
    private function allowedEnvironments(): array
    {
        /** @var array<int, mixed> $allowed */
        $allowed = (array) config('kitchens.import.environments', ['local', 'testing']);

        return array_values(array_map(strval(...), $allowed));
    }

    protected function stringOption(string $name): ?string
    {
        $value = $this->option($name);

        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
