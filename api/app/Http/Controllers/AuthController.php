<?php

namespace App\Http\Controllers;

use App\Models\Ship;
use App\Models\ShipSailor;
use App\Models\User;
use App\Services\TelegramInitDataValidator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;

class AuthController extends Controller
{
    public function __construct(
        private readonly TelegramInitDataValidator $telegramValidator,
    ) {
    }

    /**
     * Silent login: Telegram signs initData on every Mini App launch, so this
     * both logs in an existing player and creates new ones on first launch.
     */
    public function telegram(Request $request): JsonResponse
    {
        $tgUser = $this->verifiedTelegramUser($request);

        if ($tgUser === null) {
            return $this->unauthorized('Invalid or missing Telegram session');
        }

        $user = User::updateOrCreate(
            ['telegram_id' => $tgUser['id']],
            [
                'username' => $tgUser['username'] ?? null,
                'photo_url' => $tgUser['photo_url'] ?? null,
                'first_name' => $tgUser['first_name'] ?? 'Player',
            ]
        );

        return $this->issueToken($user);
    }

    public function register(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
            'first_name' => ['required', 'string', 'max:64'],
        ]);

        $user = User::create($data);

        return $this->issueToken($user);
    }

    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();

        if ($user === null || $user->password === null || ! Hash::check($data['password'], $user->password)) {
            return response()->json(['error' => ['message' => 'Invalid credentials', 'type' => 'unauthorized']], 401);
        }

        return $this->issueToken($user);
    }

    /**
     * Login or register from a Google Identity Services credential (an ID
     * token JWT handed to the frontend by Google's own button — no redirect
     * away from the Mini App / SPA).
     */
    public function google(Request $request): JsonResponse
    {
        $data = $request->validate(['id_token' => ['required', 'string']]);

        $googleUser = $this->verifyGoogleIdToken($data['id_token']);

        if ($googleUser === null) {
            return $this->unauthorized('Invalid Google credential');
        }

        $user = User::where('google_id', $googleUser['sub'])->first()
            ?? User::where('email', $googleUser['email'])->first();

        if ($user === null) {
            $user = User::create([
                'google_id' => $googleUser['sub'],
                'email' => $googleUser['email'],
                'first_name' => $googleUser['given_name'] ?? explode(' ', $googleUser['name'] ?? 'Player')[0],
            ]);
        } elseif ($user->google_id === null) {
            $user->update(['google_id' => $googleUser['sub']]);
        }

        return $this->issueToken($user);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $request->user()]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['ok' => true]);
    }

    /**
     * Attach Telegram to the currently authenticated (Google/manual) account.
     * Never auto-merges: if that Telegram id already belongs to someone else,
     * this is a conflict for the frontend to resolve, not silently combined.
     */
    public function linkTelegram(Request $request): JsonResponse
    {
        $tgUser = $this->verifiedTelegramUser($request);

        if ($tgUser === null) {
            return $this->unauthorized('Invalid or missing Telegram session');
        }

        $existing = User::where('telegram_id', $tgUser['id'])->first();

        if ($existing !== null && $existing->id !== $request->user()->id) {
            return response()->json([
                'error' => ['message' => 'This Telegram account is already linked to another profile.', 'type' => 'conflict'],
            ], 409);
        }

        $request->user()->update([
            'telegram_id' => $tgUser['id'],
            'username' => $tgUser['username'] ?? $request->user()->username,
            'photo_url' => $tgUser['photo_url'] ?? $request->user()->photo_url,
        ]);

        return response()->json(['user' => $request->user()->fresh()]);
    }

    /** Same non-merging rule as linkTelegram, mirrored for Google. */
    public function linkGoogle(Request $request): JsonResponse
    {
        $data = $request->validate(['id_token' => ['required', 'string']]);

        $googleUser = $this->verifyGoogleIdToken($data['id_token']);

        if ($googleUser === null) {
            return $this->unauthorized('Invalid Google credential');
        }

        $existing = User::where('google_id', $googleUser['sub'])->first();

        if ($existing !== null && $existing->id !== $request->user()->id) {
            return response()->json([
                'error' => ['message' => 'This Google account is already linked to another profile.', 'type' => 'conflict'],
            ], 409);
        }

        $request->user()->update(['google_id' => $googleUser['sub']]);

        return response()->json(['user' => $request->user()->fresh()]);
    }

    /**
     * @return array{id: int, username: ?string, first_name: ?string, photo_url: ?string}|null
     */
    private function verifiedTelegramUser(Request $request): ?array
    {
        $initData = $request->header('X-Telegram-Init-Data', '');

        $fields = $initData !== ''
            ? $this->telegramValidator->validate($initData, (string) config('services.telegram.bot_token'))
            : null;

        return $fields['user']['id'] ?? null ? $fields['user'] : null;
    }

    /**
     * Verifies an ID token against Google's tokeninfo endpoint and checks it
     * was issued for our own client id, rejecting tokens meant for other apps.
     *
     * @return array{sub: string, email: string, name?: string, given_name?: string}|null
     */
    private function verifyGoogleIdToken(string $idToken): ?array
    {
        $response = Http::get('https://oauth2.googleapis.com/tokeninfo', ['id_token' => $idToken]);

        if ($response->failed()) {
            return null;
        }

        $payload = $response->json();
        $clientId = config('services.google.client_id');

        if ($clientId === null || ($payload['aud'] ?? null) !== $clientId || ! isset($payload['sub'], $payload['email'])) {
            return null;
        }

        return $payload;
    }

    private function issueToken(User $user): JsonResponse
    {
        $this->ensureStarterShip($user);
        $this->ensureDefaultControls($user);

        $token = $user->createToken('api')->plainTextToken;

        return response()->json(['token' => $token, 'user' => $user]);
    }

    /**
     * Every path that can hand out a token (Telegram, register, Google) goes
     * through here, so a starter ship is guaranteed to exist by the time a
     * client can call anything else — no separate "first login" branch to
     * keep in sync per provider.
     */
    private function ensureStarterShip(User $user): void
    {
        $ship = Ship::firstOrCreate(
            ['user_id' => $user->id],
            // x/y match the realtime world's SPAWN point (map center) —
            // see WorldRoom.js/WorldPage.vue.
            ['type' => 'boat', 'hp' => config('ships.boat.max_hp'), 'x' => 2400, 'y' => 2400],
        );

        if (! $ship->wasRecentlyCreated) {
            return;
        }

        $user->update(['coins' => 300]);

        ShipSailor::create(['ship_id' => $ship->id, 'type' => 'jung', 'count' => 3]);
        $ship->ensureCannonSlots();
    }

    /**
     * The client already falls back to these same defaults on its own when
     * control_bindings is null (see loadFromServer in services/controls.js)
     * — this just makes the account row itself never sit at null, on the
     * same "guaranteed by the time a client can call anything else" basis
     * as ensureStarterShip. Runs for existing accounts too (re-login,
     * relink), not just brand new ones: only fills in what's still null,
     * so it never overwrites a real rebind.
     */
    private function ensureDefaultControls(User $user): void
    {
        if ($user->control_bindings !== null) {
            return;
        }

        // Mirrors DEFAULT_KEYBOARD/DEFAULT_GAMEPAD in
        // web/src/services/controls.js — keep in sync by hand if those ever
        // change.
        $user->update(['control_bindings' => [
            'keyboard' => [
                'moveUp' => 'KeyW', 'moveDown' => 'KeyS', 'moveLeft' => 'KeyA', 'moveRight' => 'KeyD',
                'fireLeft' => 'KeyQ', 'fireRight' => 'KeyE', 'action' => 'KeyF', 'inventory' => 'KeyI', 'back' => 'Escape',
            ],
            'gamepad' => [
                'fireLeft' => 4, 'fireRight' => 5, 'action' => 0, 'inventory' => 3, 'back' => 1,
            ],
        ]]);
    }

    private function unauthorized(string $message): JsonResponse
    {
        return response()->json(['error' => ['message' => $message, 'type' => 'unauthorized']], 401);
    }
}
