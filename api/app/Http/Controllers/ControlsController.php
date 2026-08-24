<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ControlsController extends Controller
{
    // Free-form per-action maps ({action: KeyboardEvent.code} / {action:
    // gamepad button index}) — the action names and defaults live entirely
    // client-side (services/controls.js), so this just stores whatever
    // shape it's given rather than re-declaring every action here too.
    public function show(Request $request): JsonResponse
    {
        return response()->json(['bindings' => $request->user()->control_bindings]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'keyboard' => ['sometimes', 'array'],
            'gamepad' => ['sometimes', 'array'],
        ]);

        $request->user()->update(['control_bindings' => $data]);

        return response()->json(['bindings' => $data]);
    }
}
