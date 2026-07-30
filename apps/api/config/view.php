<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | View Storage Paths
    |--------------------------------------------------------------------------
    |
    | Healthy360's API serves JSON only and owns no Blade templates: the
    | Inertia starter kit's resources/views directory was removed with the
    | rest of the starter frontend (plan §5.5) and Fortify runs with
    | views => false. The application therefore registers no view path.
    |
    | Package views (Horizon's dashboard, the framework's error and mail
    | templates) resolve through their own registered namespace hints and are
    | unaffected — including by view:cache, which compiles hinted paths too.
    |
    */

    'paths' => [],

    /*
    |--------------------------------------------------------------------------
    | Compiled View Path
    |--------------------------------------------------------------------------
    |
    | This option determines where all the compiled Blade templates will be
    | stored for your application. Typically, this is within the storage
    | directory. However, as usual, you are free to change this value.
    |
    */

    'compiled' => env(
        'VIEW_COMPILED_PATH',
        realpath(storage_path('framework/views'))
    ),

];
