<?php

use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API Routes (v1)
|--------------------------------------------------------------------------
|
| All routes here are prefixed with /api/v1/ (configured in bootstrap/app.php).
| Group by domain: auth, agents, profiles, jobs, stats, projects, tasks, etc.
|
*/

// Health check
Route::get('/ping', fn () => response()->json(['status' => 'ok', 'timestamp' => now()->toISOString()]));

// Public routes (no auth required)
// Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:auth');
// Route::get('/auth/github', [AuthController::class, 'github']);
// Route::get('/auth/github/callback', [AuthController::class, 'githubCallback']);
// Route::get('/profiles/mapping', [ProfileController::class, 'mapping']);

// Webhook routes (token/HMAC auth, no Sanctum)
// Route::prefix('webhooks')->middleware('throttle:webhooks')->group(function () {
//     Route::post('/n8n', [N8nWebhookController::class, 'handle']);
//     Route::post('/tasks', [TaskWebhookController::class, 'handle']);
// });

// Protected routes (Sanctum auth required)
// Route::middleware('auth:sanctum')->group(function () {
//     Route::post('/auth/logout', [AuthController::class, 'logout']);
//     Route::get('/auth/me', [AuthController::class, 'me']);
//
//     // Admin-only routes
//     Route::middleware('admin')->group(function () {
//         // Agents, settings, sync, etc.
//     });
//
//     // Agent+ routes (any authenticated user)
//     // Jobs, stats, projects, tasks, etc.
// });
