import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePartner } from './usePartner';

// ═══════════════════════════════════════════════════════════════════
// useLiveLocation — Smart Adaptive Location Architecture
// ═══════════════════════════════════════════════════════════════════
//
// MODES:
//   [PAGE ACTIVE]  → GPS watchPosition (5s) + Supabase Broadcast (direct P2P)
//                    Partner receives via Broadcast — instant, 0 DB egress
//   [BACKGROUND]   → GPS watchPosition stopped; setInterval DB heartbeat (30min)
//                    Partner gets last-known location from DB on page open
//
// EGRESS BREAKDOWN:
//   Broadcast messages  → WebSocket only, $0 extra DB egress
//   DB heartbeat        → 1 tiny upsert per 30 min per user (plain lat/lng)
//   DB fallback fetch   → 1 select on page open (last known position)
//   Total DB ops/day    → ~50 upserts MAX (if open 25hrs, which is impossible)
//
// PARTNER OFFLINE HANDLING:
//   If partner offline → their last position is in DB (last heartbeat)
//   When I open location page → DB fallback fetch shows their last known pos
//   When partner comes online & opens page → Broadcast resumes instantly
//
// CHANNEL: `location:{lower_id}:{higher_id}` — same room for both users
// ENCRYPTION: Plain lat/lng over TLS-encrypted WebSocket (Broadcast is
//   already transport-layer encrypted; no extra E2EE needed for coordinates)
// ═══════════════════════════════════════════════════════════════════

export interface LocationCoordinates {
  lat: number;
  lng: number;
  accuracy?: number;
  timestamp?: number;
}

// ── Constants ──────────────────────────────────────────────────────
/** Minimum distance (meters) to trigger a Broadcast update. Avoids spam when stationary. */
const MIN_DISTANCE_M = 10;
/** GPS interval when page is active (ms). */
const GPS_INTERVAL_MS = 5_000;
/** DB heartbeat interval when page is in background (ms) = 30 minutes. */
const DB_HEARTBEAT_MS = 30 * 60 * 1000;
/** Auto-stop sharing after 2 hours to save battery. */
const AUTO_STOP_MS = 2 * 60 * 60 * 1000;

// ── Haversine distance helper ──────────────────────────────────────
function haversineMeters(a: LocationCoordinates, b: LocationCoordinates): number {
  const R = 6_371_000;
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLon = (b.lng - a.lng) * (Math.PI / 180);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * (Math.PI / 180)) *
      Math.cos(b.lat * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function haversineKm(a: LocationCoordinates, b: LocationCoordinates): string {
  return (haversineMeters(a, b) / 1000).toFixed(1);
}

// ── Channel name (deterministic, same room for both users) ─────────
function getChannelName(uid1: string, uid2: string): string {
  const [a, b] = [uid1, uid2].sort();
  return `location:${a}:${b}`;
}

// ── DB helpers (plain lat/lng, no encryption needed — TLS covers transport) ──
async function dbUpsertMyLocation(
  userId: string,
  pos: LocationCoordinates,
  isSharing: boolean
): Promise<void> {
  await supabase.from('live_locations').upsert(
    {
      user_id: userId,
      lat: pos.lat,
      lng: pos.lng,
      is_sharing: isSharing,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
}

async function dbFetchPartnerLocation(
  partnerId: string
): Promise<LocationCoordinates | null> {
  const { data } = await supabase
    .from('live_locations')
    .select('lat,lng,is_sharing,updated_at')
    .eq('user_id', partnerId)
    .maybeSingle();

  if (!data || !data.is_sharing || data.lat == null || data.lng == null) return null;

  // Reject stale positions older than 2 hours
  if (data.updated_at) {
    const age = Date.now() - new Date(data.updated_at).getTime();
    if (age > AUTO_STOP_MS) return null;
  }

  return { lat: data.lat, lng: data.lng };
}

// ════════════════════════════════════════════════════════════════════
export function useLiveLocation(isPageActive: boolean) {
  const { user } = useAuth();
  const { partner } = usePartner();

  const [userLocation, setUserLocation] = useState<LocationCoordinates | null>(null);
  const [partnerLocation, setPartnerLocation] = useState<LocationCoordinates | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Refs ────────────────────────────────────────────────────────
  const watchIdRef = useRef<number | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bgHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastBroadcastPosRef = useRef<LocationCoordinates | null>(null);
  const lastDbWriteRef = useRef<number>(0);
  const isSharingRef = useRef(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const channelGenRef = useRef(0);
  const userLocationRef = useRef<LocationCoordinates | null>(null);

  // Keep refs in sync
  useEffect(() => {
    isSharingRef.current = isSharing;
  }, [isSharing]);

  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  // ── Broadcast send helper ────────────────────────────────────────
  const broadcastLocation = useCallback(
    async (pos: LocationCoordinates) => {
      if (!channelRef.current) return;
      try {
        await channelRef.current.send({
          type: 'broadcast',
          event: 'location_update',
          payload: { lat: pos.lat, lng: pos.lng, ts: Date.now() },
        });
      } catch (_) {}
    },
    []
  );

  // ── GPS position handler (called by watchPosition) ───────────────
  const handleGpsUpdate = useCallback(
    async (position: GeolocationPosition) => {
      const newPos: LocationCoordinates = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      };

      setUserLocation(newPos);
      userLocationRef.current = newPos;

      if (!isSharingRef.current || !user) return;

      // ── Distance filter: skip if < MIN_DISTANCE_M from last broadcast ──
      const last = lastBroadcastPosRef.current;
      const moved = !last || haversineMeters(last, newPos) >= MIN_DISTANCE_M;

      if (moved && isPageActive) {
        // PAGE ACTIVE → Broadcast (0 DB egress)
        lastBroadcastPosRef.current = newPos;
        broadcastLocation(newPos);
      }

      // ── DB Heartbeat: write to DB every 30 minutes regardless ──
      const now = Date.now();
      if (now - lastDbWriteRef.current >= DB_HEARTBEAT_MS) {
        lastDbWriteRef.current = now;
        dbUpsertMyLocation(user.id, newPos, true);
      }
    },
    [user, isPageActive, broadcastLocation]
  );

  // ── stopSharing ──────────────────────────────────────────────────
  const stopSharing = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (autoStopTimerRef.current) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
    if (bgHeartbeatRef.current) {
      clearInterval(bgHeartbeatRef.current);
      bgHeartbeatRef.current = null;
    }

    setIsSharing(false);
    isSharingRef.current = false;

    if (user) {
      await supabase
        .from('live_locations')
        .upsert(
          { user_id: user.id, is_sharing: false, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );
    }
  }, [user]);

  // ── startSharing ─────────────────────────────────────────────────
  const startSharing = useCallback(async () => {
    if (!user || !partner) {
      setError('Cannot share location without a partner.');
      return;
    }
    setError(null);

    try {
      // Get first position immediately
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
        })
      );

      const firstPos: LocationCoordinates = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      };

      setUserLocation(firstPos);
      userLocationRef.current = firstPos;
      setIsSharing(true);
      isSharingRef.current = true;
      lastDbWriteRef.current = Date.now();

      // Write to DB immediately so partner can see us on page load
      await dbUpsertMyLocation(user.id, firstPos, true);

      // Broadcast first position if page is active
      if (isPageActive) {
        broadcastLocation(firstPos);
        lastBroadcastPosRef.current = firstPos;
      }

      // Start GPS watch
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleGpsUpdate,
        (err) => {
          setError(err.message);
          stopSharing();
        },
        {
          enableHighAccuracy: true,
          maximumAge: GPS_INTERVAL_MS,
          timeout: 15_000,
        }
      );

      // Auto-stop after 2 hours
      autoStopTimerRef.current = setTimeout(() => stopSharing(), AUTO_STOP_MS);

    } catch (err: any) {
      setError(err.message || 'Failed to get location.');
      setIsSharing(false);
      isSharingRef.current = false;
    }
  }, [user, partner, isPageActive, handleGpsUpdate, broadcastLocation, stopSharing]);

  // ── Background DB heartbeat (fires when NOT on page, if sharing) ─
  // When page is not active, we stop Broadcast but keep a 30-min DB pulse
  // so partner can see our last known position when they open the page.
  useEffect(() => {
    if (bgHeartbeatRef.current) {
      clearInterval(bgHeartbeatRef.current);
      bgHeartbeatRef.current = null;
    }

    if (!isSharing || !user || isPageActive) return;

    // Not on page but sharing → DB heartbeat every 30 min
    bgHeartbeatRef.current = setInterval(() => {
      const pos = userLocationRef.current;
      if (pos && user) {
        lastDbWriteRef.current = Date.now();
        dbUpsertMyLocation(user.id, pos, true);
      }
    }, DB_HEARTBEAT_MS);

    return () => {
      if (bgHeartbeatRef.current) {
        clearInterval(bgHeartbeatRef.current);
        bgHeartbeatRef.current = null;
      }
    };
  }, [isSharing, isPageActive, user]);

  // ── Broadcast channel: subscribe to partner's live updates ────────
  // Only active when page is visible. Channel auto-handles reconnect.
  useEffect(() => {
    if (!user || !partner || !isPageActive) {
      // Clean up channel if we navigate away
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    const gen = ++channelGenRef.current;
    const channelName = getChannelName(user.id, partner.id);

    // Remove stale channels
    supabase
      .getChannels()
      .filter((ch) => ch.topic === `realtime:${channelName}`)
      .forEach((ch) => supabase.removeChannel(ch));

    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'location_update' }, (payload) => {
        if (gen !== channelGenRef.current) return;
        const { lat, lng } = payload.payload ?? {};
        if (typeof lat === 'number' && typeof lng === 'number') {
          setPartnerLocation({ lat, lng, timestamp: payload.payload.ts });
        }
      })
      .subscribe();

    channelRef.current = channel;

    // On page open → fetch partner's last known position from DB (covers offline partner)
    dbFetchPartnerLocation(partner.id).then((pos) => {
      if (gen !== channelGenRef.current) return;
      if (pos) setPartnerLocation(pos);
    });

    return () => {
      channelGenRef.current++;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, partner?.id, isPageActive]);

  // ── Cleanup on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (autoStopTimerRef.current) clearTimeout(autoStopTimerRef.current);
      if (bgHeartbeatRef.current) clearInterval(bgHeartbeatRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, []);

  // ── Expose distanceKm ────────────────────────────────────────────
  const distanceKm =
    userLocation && partnerLocation
      ? haversineKm(userLocation, partnerLocation)
      : null;

  return {
    userLocation,
    partnerLocation,
    isSharing,
    startSharing,
    stopSharing,
    error,
    distanceKm,
  };
}
