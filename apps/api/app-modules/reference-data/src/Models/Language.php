<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Models;

use Healthy360\ReferenceData\Database\Factories\LanguageFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * ISO 639-1 language; en and ar are active at launch.
 *
 * @property string $code
 * @property string $name_en
 * @property string $name_native
 * @property string $direction ltr | rtl
 * @property bool $is_active
 */
class Language extends Model
{
    /** @use HasFactory<LanguageFactory> */
    use HasFactory;

    protected $primaryKey = 'code';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /**
     * @var array<string>
     */
    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }
}
