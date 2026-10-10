<?php

declare(strict_types=1);

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Models\User;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\UpdatesUserPasswords;

/**
 * Replacing a password you already know.
 *
 * Fortify has always shipped the contract and this application has never bound
 * it, because until AA1 nothing needed it: a password was chosen at
 * registration and replaced through the emailed reset link. Provisioning
 * changes that. An account opened by an administrator carries a password two
 * people know, and this is the route by which it stops.
 *
 * ## `current_password` is required, including on a forced change
 *
 * The obvious shortcut — waive it when `must_change_password` is set, since the
 * person has just used that password to get here — is wrong, and worth stating
 * so nobody re-derives it. A session is not a password: it survives on a shared
 * terminal, in an unlocked phone, in a browser somebody walked away from. The
 * whole value of this route is that it takes a credential away from whoever
 * else holds it, and one that could be exercised from an abandoned session
 * would hand it to the wrong person instead.
 *
 * It also makes the forced change and the voluntary one the same request, which
 * is why there is one route rather than two.
 *
 * ## Clearing the flag is the point, not a side effect
 *
 * `must_change_password` is what makes a provisioned credential good for one
 * sign-in. It is cleared here and nowhere else — `ResetUserPassword` does not,
 * deliberately: somebody who went through the emailed reset link chose a
 * password nobody else ever saw, so the flag was already answered by a
 * different route, and leaving it set would hold them on a change-password
 * screen they have just completed.
 *
 * Which means this action does clear it for *any* successful change, including
 * a voluntary one by somebody who was never provisioned — where it is already
 * false and the write is a no-op.
 */
class UpdateUserPassword implements UpdatesUserPasswords
{
    use PasswordValidationRules;

    /**
     * @param  array<string, string>  $input
     */
    public function update(User $user, array $input): void
    {
        Validator::make($input, [
            'current_password' => $this->currentPasswordRules(),
            'password' => $this->passwordRules(),
        ], [
            'current_password.current_password' => 'That is not your current password.',
        ])->validateWithBag('updatePassword');

        $user->forceFill([
            'password' => $input['password'],
            'must_change_password' => false,
        ])->save();
    }
}
