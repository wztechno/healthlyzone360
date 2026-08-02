<?php

declare(strict_types=1);

namespace Healthy360\Identity\Auth;

use Healthy360\Identity\Enums\UserStatus;
use Illuminate\Auth\EloquentUserProvider;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Database\Eloquent\Model;

/**
 * The guard's own answer to "may this identity be used at all".
 *
 * J1 gives `users` a lifecycle (`active | suspended | closed`), and the
 * question of where that gets enforced has exactly one good answer. Adding a
 * stage to the Fortify login pipeline would cover `POST /auth/login` and miss
 * `POST /auth/token`, which authenticates through its own controller; adding
 * it to both would be two implementations of one rule, and the third entry
 * point would forget. Enforcing it in the *user provider* covers every path by
 * construction, because every path — session, token exchange, remember-me,
 * password reset — asks the provider for the user first.
 *
 * A closed account is therefore not "rejected"; it is **not found**. That is
 * the right shape for three reasons: it is enumeration-resistant (the answer
 * is indistinguishable from a wrong email), it needs no new error code, and it
 * revokes an *existing* session on its next request rather than only blocking
 * new ones — `retrieveById` is what the session guard calls on every
 * subsequent request, so closure takes effect immediately instead of when the
 * cookie expires.
 *
 * `suspended` deliberately still authenticates. Suspension is an operator's
 * restriction on what an account may *do*, and a person who cannot sign in
 * cannot see why they are suspended or appeal it. Only closure is terminal.
 */
final class ActiveUserProvider extends EloquentUserProvider
{
    /**
     * @return (Authenticatable&Model)|null
     */
    public function retrieveById($identifier): ?Authenticatable
    {
        return $this->usable(parent::retrieveById($identifier));
    }

    /**
     * @return (Authenticatable&Model)|null
     */
    public function retrieveByToken($identifier, $token): ?Authenticatable
    {
        return $this->usable(parent::retrieveByToken($identifier, $token));
    }

    /**
     * @param  array<string, mixed>  $credentials
     * @return (Authenticatable&Model)|null
     */
    public function retrieveByCredentials(array $credentials): ?Authenticatable
    {
        return $this->usable(parent::retrieveByCredentials($credentials));
    }

    /**
     * A user only if the platform will let them authenticate.
     *
     * The status is read defensively: a model without the attribute (a stub in
     * a package test, a partially hydrated instance) is treated as usable
     * rather than silently locked out, because failing closed on a *missing*
     * column would break authentication everywhere the moment the migration
     * had not run.
     *
     * @param  (Authenticatable&Model)|null  $user
     * @return (Authenticatable&Model)|null
     */
    private function usable(?Authenticatable $user): ?Authenticatable
    {
        if ($user === null) {
            return null;
        }

        $status = $user->getAttribute('status');

        if ($status instanceof UserStatus) {
            return $status->canAuthenticate() ? $user : null;
        }

        if (is_string($status)) {
            return UserStatus::tryFrom($status)?->canAuthenticate() === false ? null : $user;
        }

        return $user;
    }
}
