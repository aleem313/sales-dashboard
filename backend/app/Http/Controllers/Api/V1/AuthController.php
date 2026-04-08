<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Requests\LoginRequest;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Laravel\Socialite\Facades\Socialite;

class AuthController extends ApiController
{
    public function login(LoginRequest $request): JsonResponse
    {
        $credentials = $request->only('email', 'password');
        $credentials['email'] = strtolower($credentials['email']);

        // Check if user is active
        $user = User::where('email', $credentials['email'])->first();
        if ($user && !$user->active) {
            return $this->error('Account is deactivated.', 403);
        }

        if (!Auth::attempt($credentials)) {
            return $this->error('Invalid credentials.', 401);
        }

        $user = Auth::user();
        $token = $user->createToken('api')->plainTextToken;

        return $this->success([
            'token' => $token,
            'user' => $this->formatUser($user),
        ], 'Login successful.');
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return $this->success(null, 'Logged out.');
    }

    public function me(Request $request): JsonResponse
    {
        $user = $request->user()->load('profiles');

        return $this->success($this->formatUser($user));
    }

    public function github(): JsonResponse
    {
        $url = Socialite::driver('github')
            ->stateless()
            ->redirect()
            ->getTargetUrl();

        return $this->success(['redirect_url' => $url]);
    }

    public function githubCallback(Request $request): JsonResponse
    {
        try {
            $githubUser = Socialite::driver('github')->stateless()->user();
        } catch (\Exception $e) {
            return $this->error('GitHub authentication failed.', 401);
        }

        $email = strtolower($githubUser->getEmail());

        // Check allowed emails
        $allowedEmails = config('services.github.allowed_emails');
        if (!empty($allowedEmails) && !in_array($email, $allowedEmails)) {
            return $this->error('Email not authorized.', 403);
        }

        // Find user by github_email or email
        $user = User::where('github_email', $email)
            ->orWhere('email', $email)
            ->first();

        if (!$user) {
            // Create as admin if no matching user exists (mirrors Next.js behavior)
            $user = User::create([
                'name' => $githubUser->getName() ?? $githubUser->getNickname(),
                'email' => $email,
                'github_email' => $email,
                'avatar_url' => $githubUser->getAvatar(),
                'password' => '',
                'role' => 'admin',
                'active' => true,
            ]);
        } else {
            // Update avatar and github email
            $user->update([
                'avatar_url' => $githubUser->getAvatar(),
                'github_email' => $email,
            ]);
        }

        if (!$user->active) {
            return $this->error('Account is deactivated.', 403);
        }

        $token = $user->createToken('api')->plainTextToken;

        return $this->success([
            'token' => $token,
            'user' => $this->formatUser($user),
        ], 'GitHub login successful.');
    }

    private function formatUser(User $user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'avatar_url' => $user->avatar_url,
            'role' => $user->role,
            'active' => $user->active,
            'profiles' => $user->relationLoaded('profiles')
                ? $user->profiles->map(fn ($p) => [
                    'id' => $p->id,
                    'profile_id' => $p->profile_id,
                    'profile_name' => $p->profile_name,
                    'platform' => $p->platform,
                ])
                : null,
        ];
    }
}
