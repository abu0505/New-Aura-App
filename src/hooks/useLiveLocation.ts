// ═══════════════════════════════════════════════════════════════════
// useLiveLocation — Smart Adaptive Location Architecture
// ═══════════════════════════════════════════════════════════════════
//
// [DISABLED]
// The location feature is currently disabled to prevent egress.
//
// ═══════════════════════════════════════════════════════════════════

export interface LocationCoordinates {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp?: number;
}

// ════════════════════════════════════════════════════════════════════
export function useLiveLocation(_isPageActive: boolean) {
  // ── DISABLED ──────────────────────────────────────────────────────
  // The location feature is currently disabled to prevent egress.
  return {
    userLocation: null as LocationCoordinates | null,
    partnerLocation: null as LocationCoordinates | null,
    isSharing: false,
    startSharing: async () => {},
    stopSharing: async () => {},
    error: null as string | null,
    distanceKm: null as string | null,
  };
}
