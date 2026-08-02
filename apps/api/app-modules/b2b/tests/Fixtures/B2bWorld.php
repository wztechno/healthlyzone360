<?php

declare(strict_types=1);

namespace Healthy360\B2b\Tests\Fixtures;

use App\Models\User;
use Healthy360\B2b\Enums\DocumentKind;
use Healthy360\B2b\Models\B2bApplication;
use Healthy360\B2b\Models\KycDocument;
use Illuminate\Http\UploadedFile;
use RuntimeException;

/**
 * The world the B2B suites are set in.
 *
 * A fixture class rather than Pest helper functions, for the reason
 * `DeliveryWorld` and `PricingWorld` give: Pest loads every test file in the
 * suite into one process, so two files declaring the same helper function
 * would be a fatal redeclaration rather than a test failure.
 *
 * There is no organisation plumbing here, and that is the shape of the phase
 * rather than an omission. A B2B application exists precisely because its
 * applicant has no organisation yet.
 */
final class B2bWorld
{
    public static function applicant(string $email = 'applicant@b2b.test'): User
    {
        return User::factory()->create(['email' => $email]);
    }

    public static function reviewer(string $email = 'reviewer@b2b.test'): User
    {
        return User::factory()->create(['email' => $email]);
    }

    /**
     * A draft carrying every required field and both required documents —
     * everything the server checks at submission, so a test asserting a
     * transition is not really asserting a validator.
     */
    public static function readyApplication(User $applicant): B2bApplication
    {
        /** @var B2bApplication $application */
        $application = B2bApplication::factory()->create(['applicant_user_id' => $applicant->getKey()]);

        foreach (DocumentKind::requiredForB2bSubmission() as $kind) {
            KycDocument::factory()->forApplication($application)->ofKind($kind)->create();
        }

        return $application;
    }

    /**
     * An upload whose leading bytes really are a PDF's.
     *
     * `UploadedFile::fake()->create()` writes a file of the requested length
     * filled with nothing, which the sniffer correctly refuses — useful for
     * the refusal case and useless for the acceptance one. This writes a real
     * signature.
     */
    public static function pdfUpload(string $name = 'registration.pdf', string $declaredMime = 'application/pdf'): UploadedFile
    {
        return self::upload($name, "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", $declaredMime);
    }

    /**
     * A file claiming to be a PDF whose bytes are a Windows executable's. The
     * mislabelled upload the sniffer exists for.
     */
    public static function disguisedExecutable(string $name = 'registration.pdf'): UploadedFile
    {
        return self::upload($name, "MZ\x90\x00\x03\x00\x00\x00This is not a PDF.", 'application/pdf');
    }

    private static function upload(string $name, string $contents, string $declaredMime): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'b2b');

        if ($path === false) {
            throw new RuntimeException('A temporary file could not be created for the fixture upload.');
        }

        file_put_contents($path, $contents);

        // `$test: true` so the constructor does not insist the file arrived
        // through a real upload.
        return new UploadedFile($path, $name, $declaredMime, null, true);
    }
}
