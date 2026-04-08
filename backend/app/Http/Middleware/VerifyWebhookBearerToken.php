<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class VerifyWebhookBearerToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();

        if (empty($token)) {
            return response()->json(['message' => 'Missing Bearer token.'], 401);
        }

        $tokenHash = hash('sha256', $token);

        $config = DB::table('webhook_configs')
            ->where('token_hash', $tokenHash)
            ->where('active', true)
            ->first();

        if (!$config) {
            return response()->json(['message' => 'Invalid webhook token.'], 401);
        }

        $request->merge(['_webhook_config' => $config]);

        return $next($request);
    }
}
