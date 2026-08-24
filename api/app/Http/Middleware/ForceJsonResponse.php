<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * This API has no login page to redirect to — every client (web frontend,
 * the realtime service's server-to-server checks, curl) must always get a
 * clean JSON response, never a redirect. Auth::redirectTo() only avoids
 * that redirect when the request "expects JSON", which depends on the
 * client remembering an Accept header. Forcing it here means that's
 * guaranteed for every api/* request regardless of what any given client
 * sends — one fix instead of a header to remember in every caller.
 */
class ForceJsonResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->headers->set('Accept', 'application/json');

        return $next($request);
    }
}
