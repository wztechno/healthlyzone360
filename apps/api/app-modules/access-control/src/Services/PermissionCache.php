<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Services;

use Closure;
use Illuminate\Support\Facades\Cache;

/**
 * Cache of calculated permission codes per (user, organisation, branch),
 * invalidated by version counters rather than manual key deletion (plan §10):
 * any role / role-permission / membership-role / membership / entitlement
 * write bumps the owning organisation's counter (or the platform counter for
 * template rows), and the counters are embedded in every cache key. Uses the
 * default cache store — Redis in every deployed environment.
 */
final class PermissionCache
{
    private const int TTL_SECONDS = 300;

    private const string KEY_PREFIX = 'h360:perms';

    private const string VERSION_PREFIX = 'h360:perm-version';

    private const string PLATFORM_VERSION_KEY = 'h360:perm-version:platform';

    /**
     * @param  Closure(): list<string>  $resolve
     * @return list<string>
     */
    public function remember(string $userId, string $organisationId, ?string $branchId, Closure $resolve): array
    {
        $key = sprintf(
            '%s:g%d:o%d:%s:%s:%s',
            self::KEY_PREFIX,
            $this->platformVersion(),
            $this->organisationVersion($organisationId),
            $organisationId,
            $userId,
            $branchId ?? 'org-wide',
        );

        /** @var list<string> */
        return Cache::remember($key, self::TTL_SECONDS, $resolve);
    }

    /**
     * Bump the version counter after a permission-affecting write. A NULL
     * organisation means a platform template changed, which invalidates
     * every organisation's calculated permissions.
     */
    public function bumpVersion(?string $organisationId): void
    {
        Cache::increment($organisationId === null
            ? self::PLATFORM_VERSION_KEY
            : self::VERSION_PREFIX.':'.$organisationId);
    }

    public function organisationVersion(string $organisationId): int
    {
        return (int) Cache::get(self::VERSION_PREFIX.':'.$organisationId, 0);
    }

    /**
     * The opaque version stamp returned as `meta.permissions_version`, so a
     * client can detect that its cached permission set is stale without
     * understanding how the counters are composed.
     */
    public function signature(?string $organisationId): string
    {
        return sprintf(
            '%d.%d',
            $this->platformVersion(),
            $organisationId === null ? 0 : $this->organisationVersion($organisationId),
        );
    }

    public function platformVersion(): int
    {
        return (int) Cache::get(self::PLATFORM_VERSION_KEY, 0);
    }
}
