<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => response()->json([
    'data' => [
        'name' => config('app.name'),
        'api' => 'healthy360',
    ],
]))->name('home');
