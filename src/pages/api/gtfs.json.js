import gtfsRealtimeBindings from "gtfs-realtime-bindings";
import stopsData from "../../data/stops.json"; // adjust path relative to your api file if needed

export const prerender = false;

const VEHICLE_POSITIONS_URL = "https://cttprdtmgtfs.ctttrpcloud.com/TMGTFSRealTimeWebService/Vehicle/VehiclePositions.pb";
const TRIP_UPDATES_URL = "https://cttprdtmgtfs.ctttrpcloud.com/TMGTFSRealTimeWebService/TripUpdate/TripUpdates.pb";

export async function GET() {
  try {
    const [vehRes, tripRes] = await Promise.all([
      fetch(VEHICLE_POSITIONS_URL, { cache: "no-store" }),
      fetch(TRIP_UPDATES_URL, { cache: "no-store" }).catch(() => null),
    ]);

    const vehBuffer = await vehRes.arrayBuffer();
    const vehFeed = gtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(vehBuffer));

    const vehicles = vehFeed.entity
      .filter((e) => e.vehicle && e.vehicle.position)
      .map((e) => {
        const v = e.vehicle;
        const rawRouteId = v.trip?.routeId || "";
        const cleanId = rawRouteId.includes("_") ? rawRouteId.split("_").pop() : rawRouteId;
        const routeDisplay = cleanId.length > 4 ? `CTtransit Route #${cleanId.slice(-3)}` : `Route ${cleanId}`;
        const vehicleLabel = v.vehicle?.label || v.vehicle?.id || "Bus";

        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [v.position.longitude, v.position.latitude],
          },
          properties: {
            id: e.id,
            label: vehicleLabel,
            route_id: routeDisplay,
            speed: Math.round((v.position.speed || 0) * 2.23694), // m/s to mph
            lat: v.position.latitude,
            lon: v.position.longitude,
          },
        };
      });

    let stopWaitTimes = {};

    // parse gtfs - rt
    if (tripRes && tripRes.ok) {
      try {
        const tripBuffer = await tripRes.arrayBuffer();
        const tripFeed = gtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(tripBuffer));

        tripFeed.entity.forEach((e) => {
          if (e.tripUpdate && e.tripUpdate.stopTimeUpdate) {
            e.tripUpdate.stopTimeUpdate.forEach((stu) => {
              if (stu.stopId && stu.arrival) {
                const arrivalTime = stu.arrival.time ? stu.arrival.time.low * 1000 : null;
                if (arrivalTime) {
                  const waitMins = Math.max(1, Math.round((arrivalTime - Date.now()) / 60000));
                  stopWaitTimes[stu.stopId] = { waitMins };
                }
              }
            });
          }
        });
      } catch (parseErr) {
        console.warn("Could not parse GTFS trip updates, falling back to proximity calculation:", parseErr);
      }
    }

    // 
    if (vehicles.length > 0) {
      
    }

    return new Response(
      JSON.stringify({
        type: "FeatureCollection",
        features: vehicles,
        stopWaitTimes,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (err) {
    console.error("Error fetching GTFS-RT feed:", err);
    return new Response(JSON.stringify({ type: "FeatureCollection", features: [], stopWaitTimes: {} }), { status: 500 });
  }
}