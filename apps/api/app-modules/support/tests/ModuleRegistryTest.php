<?php

declare(strict_types=1);

use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The module registry is enforced, not merely documented (plan v2 §4.1)
|--------------------------------------------------------------------------
|
| `docs/architecture/module-registry.yaml` states which modules exist and what
| each one is allowed to be. This test is what makes the statement true: a
| module that is `planned` may not grow a directory or a composer package, and
| a directory under `app-modules/` may not exist without a registry entry that
| permits code. A status change and this test move in the same commit, always.
|
| Status vocabulary: planned (no code) · foundation (schema and internal
| management exist) · active (declared capability complete) · deprecated ·
| retired. `foundation` and `active` permit code; `active` does not require it —
| Localisation and PlatformAdministration are registry-only entries.
|
| The registry is read by a deliberately strict reader rather than a YAML
| library: `apps/api` declares no YAML dependency, the file's shape is small and
| fixed, and a reader that refuses every line it does not recognise cannot
| silently mis-read the file it is supposed to police.
|
*/

/**
 * Statuses under which a module may hold code, migrations and routes. No module
 * has reached `deprecated` or `retired` yet; the first one to do so extends this
 * list as a deliberate act rather than inheriting a permission by accident.
 *
 * @return list<string>
 */
function statusesPermittingCode(): array
{
    return ['foundation', 'active'];
}

/**
 * The whole status vocabulary, in lifecycle order.
 *
 * @return list<string>
 */
function moduleStatusVocabulary(): array
{
    return ['planned', 'foundation', 'active', 'deprecated', 'retired'];
}

/**
 * The module registry, keyed by module name.
 *
 * @return array<string, array{status: string, phase: int|null, description: string, depends_on: list<string>}>
 */
function moduleRegistry(): array
{
    /** @var array<string, array{status: string, phase: int|null, description: string, depends_on: list<string>}>|null $registry */
    static $registry = null;

    if ($registry !== null) {
        return $registry;
    }

    $path = base_path('../../docs/architecture/module-registry.yaml');
    $contents = file_get_contents($path);

    if ($contents === false) {
        throw new RuntimeException("The module registry could not be read from {$path}.");
    }

    $registry = [];
    $name = null;
    $inModules = false;

    foreach (explode("\n", str_replace("\r\n", "\n", $contents)) as $index => $line) {
        $number = $index + 1;

        if (trim($line) === '' || str_starts_with(ltrim($line), '#')) {
            continue;
        }

        if ($line === 'modules:') {
            $inModules = true;

            continue;
        }

        if (! $inModules) {
            // Document header (version, updated): a scalar at column zero.
            if (preg_match('/^[a-z_]+: \S/', $line) !== 1) {
                throw new RuntimeException("Unrecognised registry header at line {$number}: {$line}");
            }

            continue;
        }

        if (str_starts_with($line, '  - name: ')) {
            $name = trim(substr($line, 10));
            $registry[$name] = ['status' => '', 'phase' => null, 'description' => '', 'depends_on' => []];

            continue;
        }

        if (preg_match('/^    ([a-z_]+): (.*)$/', $line, $matches) !== 1 || $name === null) {
            throw new RuntimeException("Unrecognised registry line {$number}: {$line}");
        }

        [, $key, $value] = $matches;

        match ($key) {
            'status' => $registry[$name]['status'] = trim($value),
            'phase' => $registry[$name]['phase'] = (int) trim($value),
            'description' => $registry[$name]['description'] = trim($value),
            'depends_on' => $registry[$name]['depends_on'] = array_values(array_filter(
                array_map(trim(...), explode(',', trim($value, "[] \t"))),
                static fn (string $dependency): bool => $dependency !== '',
            )),
            default => throw new RuntimeException("Unrecognised registry key '{$key}' at line {$number}."),
        };
    }

    if ($registry === []) {
        throw new RuntimeException('The module registry parsed to no modules at all.');
    }

    return $registry;
}

/**
 * Directory names a module would occupy under `app-modules/`. Two candidates
 * because the kebab of a name containing digits is not the name a developer
 * would type (`B2B` kebabs to `b2-b`), and the test must catch either.
 *
 * @return list<string>
 */
function moduleDirectoryCandidates(string $name): array
{
    return array_values(array_unique([Str::kebab($name), Str::lower($name)]));
}

/**
 * The directories that actually exist under `app-modules/`.
 *
 * @return list<string>
 */
function existingModuleDirectories(): array
{
    $directories = glob(base_path('app-modules').'/*', GLOB_ONLYDIR);

    return array_values(array_map(basename(...), $directories === false ? [] : $directories));
}

/**
 * The composer packages `apps/api` requires, keyed by name.
 *
 * @return list<string>
 */
function apiComposerRequirements(): array
{
    $contents = file_get_contents(base_path('composer.json'));

    if ($contents === false) {
        throw new RuntimeException('apps/api/composer.json could not be read.');
    }

    /** @var array{require?: array<string, string>} $manifest */
    $manifest = json_decode($contents, true, flags: JSON_THROW_ON_ERROR);

    return array_keys($manifest['require'] ?? []);
}

it('gives every module a status from the vocabulary and a description', function (): void {
    foreach (moduleRegistry() as $name => $module) {
        expect($module['status'])->toBeIn(moduleStatusVocabulary(), "Module {$name} has an unregistered status.")
            ->and($module['description'])->not->toBe('', "Module {$name} has no description.");
    }
});

it('backs every module directory with a registry entry that permits code', function (): void {
    $owners = [];

    foreach (moduleRegistry() as $name => $module) {
        foreach (moduleDirectoryCandidates($name) as $candidate) {
            $owners[$candidate] = $name;
        }
    }

    foreach (existingModuleDirectories() as $directory) {
        $this->assertArrayHasKey($directory, $owners, "app-modules/{$directory} has no module-registry entry.");

        $name = $owners[$directory];

        expect(moduleRegistry()[$name]['status'])->toBeIn(
            statusesPermittingCode(),
            "app-modules/{$directory} exists but {$name} is not a status that may hold code.",
        );
    }
});

it('leaves planned modules without a directory or a composer package', function (): void {
    $directories = existingModuleDirectories();
    $requirements = apiComposerRequirements();

    foreach (moduleRegistry() as $name => $module) {
        if ($module['status'] !== 'planned') {
            continue;
        }

        foreach (moduleDirectoryCandidates($name) as $candidate) {
            $this->assertNotContains(
                $candidate,
                $directories,
                "{$name} is planned but app-modules/{$candidate} exists.",
            );

            $this->assertNotContains(
                "healthy360/{$candidate}",
                $requirements,
                "{$name} is planned but apps/api requires healthy360/{$candidate}.",
            );
        }
    }
});

it('resolves every dependency edge to a registered module', function (): void {
    $registry = moduleRegistry();

    foreach ($registry as $name => $module) {
        foreach ($module['depends_on'] as $dependency) {
            $this->assertArrayHasKey($dependency, $registry, "{$name} depends on unregistered module {$dependency}.");
            $this->assertNotSame($name, $dependency, "{$name} depends on itself.");
        }
    }
});

it('never lets a module that may hold code depend on one that may not', function (): void {
    $registry = moduleRegistry();

    foreach ($registry as $name => $module) {
        if (! in_array($module['status'], statusesPermittingCode(), true)) {
            continue;
        }

        foreach ($module['depends_on'] as $dependency) {
            expect($registry[$dependency]['status'])->toBeIn(
                statusesPermittingCode(),
                "{$name} may hold code but depends on {$dependency}, which may not.",
            );
        }
    }
});

it('keeps the dependency graph acyclic', function (): void {
    $registry = moduleRegistry();
    $state = [];

    $walk = function (string $name, array $path) use (&$walk, &$state, $registry): void {
        if (($state[$name] ?? null) === 'done') {
            return;
        }

        $this->assertNotSame(
            'open',
            $state[$name] ?? null,
            'Dependency cycle: '.implode(' → ', [...$path, $name]),
        );

        $state[$name] = 'open';

        foreach ($registry[$name]['depends_on'] as $dependency) {
            $walk($dependency, [...$path, $name]);
        }

        $state[$name] = 'done';
    };

    foreach (array_keys($registry) as $name) {
        $walk($name, []);
    }
});
