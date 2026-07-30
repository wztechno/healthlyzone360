<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\Consent\Models\ConsentGrant;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;

/*
|--------------------------------------------------------------------------
| Data classification (plan §12)
|--------------------------------------------------------------------------
|
| Phase 6 delivers the vocabulary, the declaration and the reader; nothing
| yet derives redaction or encryption from them automatically. These tests
| therefore assert what genuinely exists — that the declarations are present,
| readable and consistent — and claim nothing about enforcement.
|
*/

it('classifies credentials on the global identity as restricted', function (): void {
    $map = Classified::map(User::class);

    expect($map)->toMatchArray([
        'password' => DataClassification::Restricted,
        'two_factor_secret' => DataClassification::Restricted,
        'two_factor_recovery_codes' => DataClassification::Restricted,
        'remember_token' => DataClassification::Restricted,
        'email' => DataClassification::Confidential,
    ]);
});

it('classifies every hidden attribute of the user at least as confidential', function (): void {
    $map = Classified::map(User::class);
    $user = new User;

    foreach ($user->getHidden() as $attribute) {
        expect($map)->toHaveKey($attribute)
            ->and($map[$attribute])->toBe(DataClassification::Restricted);
    }
});

it('classifies person data on the profile as confidential', function (): void {
    expect(Classified::map(UserProfile::class))->toMatchArray([
        'given_name' => DataClassification::Confidential,
        'family_name' => DataClassification::Confidential,
        'date_of_birth' => DataClassification::Confidential,
        'preferred_language_code' => DataClassification::Internal,
    ]);
});

it('classifies consent as special category data', function (): void {
    expect(Classified::map(ConsentGrant::class))->toMatchArray([
        'user_id' => DataClassification::SpecialCategory,
        'status' => DataClassification::SpecialCategory,
        'granted_at' => DataClassification::SpecialCategory,
        'organisation_id' => DataClassification::Internal,
    ]);
});

it('requires a purpose of use only for special category data', function (): void {
    expect(DataClassification::SpecialCategory->requiresPurposeOfUse())->toBeTrue()
        ->and(DataClassification::Confidential->requiresPurposeOfUse())->toBeFalse()
        ->and(DataClassification::Public->requiresPurposeOfUse())->toBeFalse();
});

it('returns an empty map for a class that declares nothing', function (): void {
    expect(Classified::map(DateTimeImmutable::class))->toBe([]);
});
