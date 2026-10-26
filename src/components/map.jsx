import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import stopsData from "../data/stops.json";
 const key = "key";

key;

// route mapper
const getFriendlyRouteName = (agencyPrefix, stopId, routeId = "") => {
  const agency = (agencyPrefix || "").toLowerCase();
  const raw = String(routeId || stopId);
  
  if (agency.includes("bus")) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 4) {
      const suffix = digits.slice(-2);
      return `CTtransit Route 2${suffix}`;
    }
    return digits ? `CTtransit Route ${digits}` : "CTtransit Local Bus";
  } else if (agency.includes("hl") || agency.includes("hartford")) {
    return "Hartford Line Rail";
  } else if (agency.includes("sle") || agency.includes("shore")) {
    return "Shore Line East Rail";
  }
  return "Local Transit Connection";
};

export default function Map() {
  const mapContainerRef = useRef(null);
  const map = useRef(null);
  const userMarkerRef = useRef(null);
  
  const [selectedStop, setSelectedStop] = useState(null);
  const [showUnknownModal, setShowUnknownModal] = useState(false);

  //sync reports and wait time
  const [stopReportsMap, setStopReportsMap] = useState({});
  const [realtimeWaitTimes, setRealtimeWaitTimes] = useState({});

  // form State
  const [verificationChoice, setVerificationChoice] = useState("1");
  const [verificationNote, setVerificationNote] = useState("");
  const [verificationPhoto, setVerificationPhoto] = useState(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // trip planner 
  const [originSearch, setOriginSearch] = useState("");
  const [originId, setOriginId] = useState("");
  const [showOriginSuggestions, setShowOriginSuggestions] = useState(false);

  const [destinationSearch, setDestinationSearch] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);

  const [tripResult, setTripResult] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  // poll server for accessibility reports
  useEffect(() => {
    async function fetchReports() {
      try {
        const res = await fetch(`/api/accessibility.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();

        const initialMap = {};
        stopsData.forEach((s) => {
          const rawWb = s.wheelchair_boarding !== undefined && s.wheelchair_boarding !== null
            ? String(s.wheelchair_boarding).trim()
            : "0";
          const defaultStatus = rawWb === "1" ? "yes" : rawWb === "2" ? "no" : "unknown";

          const serverEntry = data[s.stop_id];
          const serverStatus = typeof serverEntry === "object" ? serverEntry?.status : serverEntry;
          const serverNote = typeof serverEntry === "object" ? serverEntry?.note : "";
          const serverPhoto = typeof serverEntry === "object" ? serverEntry?.photo : null;

          initialMap[s.stop_id] = {
            status: serverStatus || defaultStatus,
            note: serverNote || "",
            photo: serverPhoto || null,
          };
        });

        setStopReportsMap(initialMap);
      } catch (err) {
        console.error("Failed to load accessibility reports:", err);
      }
    }

    fetchReports();
    const intervalId = setInterval(fetchReports, 3000);
    return () => clearInterval(intervalId);
  }, []);

  // sync selected stop card when reports or wait times update
  useEffect(() => {
    if (!selectedStop || selectedStop._isVehicle) return;

    const latestReport = stopReportsMap[selectedStop.stop_id];
    const liveWait = realtimeWaitTimes[selectedStop.stop_id];

    if (latestReport || liveWait !== undefined) {
      setSelectedStop((prev) => {
        if (!prev) return prev;
        const newStatus = latestReport?.status || prev.wheelchair;
        const newNote = latestReport?.note || prev.note;
        const newPhoto = latestReport?.photo || prev.photo;
        const newWait = liveWait?.waitMins !== undefined ? liveWait.waitMins : prev.waitMins;

        if (
          prev.wheelchair === newStatus &&
          prev.note === newNote &&
          prev.photo === newPhoto &&
          prev.waitMins === newWait
        ) {
          return prev;
        }

        return {
          ...prev,
          wheelchair: newStatus,
          note: newNote,
          photo: newPhoto,
          waitMins: newWait,
        };
      });
    }
  }, [stopReportsMap, realtimeWaitTimes]);

  useEffect(() => {
    if (map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: [-72.9263, 41.2975],
      zoom: 8,
    });

    setTimeout(() => map.current?.resize(), 200);

    map.current.on("load", () => {
      map.current.resize();

      const stopsGeoJSON = {
        type: "FeatureCollection",
        features: stopsData.map((stop) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [parseFloat(stop.stop_lon), parseFloat(stop.stop_lat)],
          },
          properties: {
            stop_id: stop.stop_id,
            stop_name: stop.stop_name,
            agency_prefix: stop.agency_prefix,
            wheelchair: stopReportsMap[stop.stop_id]?.status || "unknown",
          },
        })),
      };

      map.current.addSource("stops", { type: "geojson", data: stopsGeoJSON });
      map.current.addLayer({
        id: "stops-layer",
        type: "circle",
        source: "stops",
        paint: {
          "circle-radius": ["match", ["get", "wheelchair"], "no", 7, 6],
          "circle-color": [
            "case",
            ["==", ["get", "wheelchair"], "no"], "#EF4444",
            ["==", ["get", "wheelchair"], "unknown"], "#94A3B8",
            ["match", ["get", "agency_prefix"],
              "bus", "#1f77b4",
              "hl", "#22C55E",
              "sle", "#22C55E",
              "#3B82F6"
            ]
          ],
          "circle-stroke-width": ["match", ["get", "wheelchair"], "no", 2, 1],
          "circle-stroke-color": ["match", ["get", "wheelchair"], "no", "#991B1B", "#ffffff"]
        },
      });

      // route Polyline Layer
      map.current.addSource("route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });
      map.current.addLayer({
        id: "route-layer",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#2563eb", "line-width": 5, "line-opacity": 0.85 }
      });

      map.current.addSource("vehicles", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.current.addLayer({
        id: "vehicles-layer",
        type: "circle",
        source: "vehicles",
        paint: {
          "circle-radius": 8,
          "circle-color": "#FF5733",
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#fff",
        },
      });

      const updateVehicles = async () => {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}api/gtfs.json`);
          const data = await response.json();
          map.current.getSource("vehicles")?.setData(data);
          if (data.stopWaitTimes) {
            setRealtimeWaitTimes(data.stopWaitTimes);
          }
        } catch (error) {
          console.error("Error updating vehicles:", error);
        }
      };

      updateVehicles();
      const intervalId = setInterval(updateVehicles, 10000);

      map.current.on("mouseenter", "stops-layer", () => map.current.getCanvas().style.cursor = "pointer");
      map.current.on("mouseleave", "stops-layer", () => map.current.getCanvas().style.cursor = "");
      map.current.on("mouseenter", "vehicles-layer", () => map.current.getCanvas().style.cursor = "pointer");
      map.current.on("mouseleave", "vehicles-layer", () => map.current.getCanvas().style.cursor = "");

      map.current.on("click", "vehicles-layer", (e) => {
        const feature = e.features?.[0];
        if (feature) {
          setShowUnknownModal(false);
          const rawRoute = feature.properties.route_id || "";
          const friendlyRoute = getFriendlyRouteName("bus", "", rawRoute);

          setSelectedStop({
            label: feature.properties.label || "Transit Bus",
            route_id: friendlyRoute,
            speed: feature.properties.speed ?? 0,
            _isVehicle: true,
          });
        }
      });

      map.current.on("click", "stops-layer", (e) => {
        const feature = e.features?.[0];
        if (feature) {
          const props = feature.properties;
          const report = stopReportsMap[props.stop_id] || { status: "unknown", note: "", photo: null };
          
          let liveWait = realtimeWaitTimes[props.stop_id]?.waitMins;
          if (liveWait === undefined || liveWait === null) {
            const numericHash = parseInt(props.stop_id.replace(/\D/g, "") || "5", 10);
            liveWait = (numericHash % 10) + 2; 
          }

          setSelectedStop({
            ...props,
            wheelchair: report.status,
            note: report.note,
            photo: report.photo,
            waitMins: liveWait,
            _isVehicle: false,
          });
          setIsSubmitted(false);
          setVerificationNote(report.note || "");
          setVerificationPhoto(null);
          setVerificationChoice(report.status === "yes" ? "1" : "2");
        }
      });

      return () => clearInterval(intervalId);
    });
  }, [stopReportsMap]);

  // sync mapbox
  useEffect(() => {
    if (!map.current || !map.current.getSource("stops")) return;

    const updatedGeoJSON = {
      type: "FeatureCollection",
      features: stopsData.map((stop) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [parseFloat(stop.stop_lon), parseFloat(stop.stop_lat)],
        },
        properties: {
          stop_id: stop.stop_id,
          stop_name: stop.stop_name,
          agency_prefix: stop.agency_prefix,
          wheelchair: stopReportsMap[stop.stop_id]?.status || "unknown",
        },
      })),
    };

    map.current.getSource("stops").setData(updatedGeoJSON);
  }, [stopReportsMap]);

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => setVerificationPhoto(reader.result);
    reader.readAsDataURL(file);
  };

  const handleVerificationSubmit = async (e) => {
    e.preventDefault();
    if (!selectedStop) return;

    const newStatus = verificationChoice === "1" ? "yes" : "no";

    try {
      const response = await fetch('/api/accessibility.json', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stop_id: selectedStop.stop_id,
          status: newStatus,
          note: verificationNote,
          photo: verificationPhoto || selectedStop.photo,
        }),
      });

      if (response.ok) {
        const updatedPhoto = verificationPhoto || selectedStop.photo || null;

        setStopReportsMap((prev) => ({
          ...prev,
          [selectedStop.stop_id]: {
            status: newStatus,
            note: verificationNote,
            photo: updatedPhoto,
          },
        }));

        setSelectedStop((prev) => ({
          ...prev,
          wheelchair: newStatus,
          note: verificationNote,
          photo: updatedPhoto,
        }));

        setIsSubmitted(true);
      } else {
        alert("Failed to save report to server.");
      }
    } catch (err) {
      console.error("Failed to submit report:", err);
      alert("Error saving report.");
    }
  };

  const handleUseGPS = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    setGpsLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsLoading(false);
        const userLng = position.coords.longitude;
        const userLat = position.coords.latitude;

        map.current.flyTo({ center: [userLng, userLat], zoom: 14 });

        if (userMarkerRef.current) {
          userMarkerRef.current.setLngLat([userLng, userLat]);
        } else {
          const el = document.createElement("div");
          el.style.width = "16px";
          el.style.height = "16px";
          el.style.backgroundColor = "#2563eb";
          el.style.border = "3px solid white";
          el.style.borderRadius = "50%";
          el.style.boxShadow = "0 0 10px rgba(0,0,0,0.3)";

          userMarkerRef.current = new mapboxgl.Marker(el)
            .setLngLat([userLng, userLat])
            .addTo(map.current);
        }

        let nearestStop = null;
        let minDistance = Infinity;

        stopsData.forEach((stop) => {
          const sLat = parseFloat(stop.stop_lat);
          const sLng = parseFloat(stop.stop_lon);
          const dist = Math.pow(sLat - userLat, 2) + Math.pow(sLng - userLng, 2);
          if (dist < minDistance) {
            minDistance = dist;
            nearestStop = stop;
          }
        });

        if (nearestStop) {
          setOriginId(nearestStop.stop_id);
          setOriginSearch(`${nearestStop.stop_name} (${nearestStop.agency_prefix})`);
          alert(`Found your location! Nearest stop set to: ${nearestStop.stop_name}`);
        }
      },
      (error) => {
        setGpsLoading(false);
        alert("Unable to retrieve location.");
        console.error(error);
      },
      { enableHighAccuracy: true }
    );
  };

  // plan trip with rough trasfer point detection
  const handlePlanTrip = async (e) => {
    e.preventDefault();
    if (!originId || !destinationId) {
      alert("Please select both a valid origin and destination station from recommendations.");
      return;
    }

    const originStop = stopsData.find(s => s.stop_id === originId);
    const destStop = stopsData.find(s => s.stop_id === destinationId);

    if (!originStop || !destStop) {
      alert("Selected stops could not be found.");
      return;
    }

    const originReport = stopReportsMap[originStop.stop_id] || { status: "unknown" };
    const destReport = stopReportsMap[destStop.stop_id] || { status: "unknown" };
    const originWait = realtimeWaitTimes[originStop.stop_id]?.waitMins ?? 5;

    const primaryRoute = getFriendlyRouteName(originStop.agency_prefix, originStop.stop_id);
    const destRoute = getFriendlyRouteName(destStop.agency_prefix, destStop.stop_id);

    const oLon = parseFloat(originStop.stop_lon);
    const oLat = parseFloat(originStop.stop_lat);
    const dLon = parseFloat(destStop.stop_lon);
    const dLat = parseFloat(destStop.stop_lat);

    const latDiff = dLat - oLat;
    const lonDiff = dLon - oLon;
    const estMiles = (Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 69).toFixed(1);

    let transitSteps = [
      `Board ${primaryRoute} at ${originStop.stop_name}`,
    ];

    let transfers = 0;
    if (primaryRoute !== destRoute || parseFloat(estMiles) > 3.0) {
      transfers = 1;
      
      const combinedText = `${originStop.stop_name} ${destStop.stop_name}`.toLowerCase();
      let transferHub = "Central Transfer Hub";

      if (combinedText.includes("new haven") || combinedText.includes("state st") || combinedText.includes("state street")) {
        transferHub = "New Haven Union Station Hub";
      } else if (combinedText.includes("wallingford")) {
        transferHub = "Wallingford Station Intermodal Hub";
      } else if (combinedText.includes("meriden")) {
        transferHub = "Meriden Transit Center Hub";
      } else if (combinedText.includes("hartford") || combinedText.includes("new britain")) {
        transferHub = "Hartford CTtransit Central Station";
      } else if (combinedText.includes("hamden") || combinedText.includes("north haven")) {
        transferHub = "Hamden Plaza Transfer Point";
      } else {
        transferHub = `${originStop.stop_name.split(" ")[0]} Connection Terminal`;
      }

      transitSteps.push(`Transfer at ${transferHub}: Disembark and switch to connecting ${destRoute}`);
    }

    transitSteps.push(`Arrive and disembark at ${destStop.stop_name}`);

    try {
      const profile = transfers > 0 ? "mapbox/cycling" : "mapbox/walking";
      const coords = `${oLon},${oLat};${dLon},${dLat}`;
      const dirRes = await fetch(
        `https://api.mapbox.com/directions/v5/${profile}/${coords}?steps=true&geometries=geojson&access_token=${mapboxgl.accessToken}`
      );
      
      if (!dirRes.ok) throw new Error(`Directions API error: ${dirRes.status}`);
      const dirData = await dirRes.json();

      let routeMiles = estMiles;
      let estMinutes = Math.max(10, Math.round(estMiles * 12));

      if (dirData.routes && dirData.routes.length > 0) {
        const route = dirData.routes[0];
        routeMiles = (route.distance / 1609.34).toFixed(1);
        estMinutes = Math.round(route.duration / 40);

        if (map.current && map.current.getSource("route")) {
          map.current.getSource("route").setData({
            type: "Feature",
            geometry: route.geometry
          });

          const coordinates = route.geometry.coordinates;
          if (coordinates && coordinates.length > 0) {
            const bounds = coordinates.reduce(
              (b, coord) => b.extend(coord), 
              new mapboxgl.LngLatBounds(coordinates[0], coordinates[0])
            );
            map.current.fitBounds(bounds, { padding: 60 });
          }
        }
      }

      setTripResult({
        originName: originStop.stop_name,
        destName: destStop.stop_name,
        originLat: oLat,
        originLon: oLon,
        destLat: dLat,
        destLon: dLon,
        primaryRoute,
        estMiles: routeMiles,
        estMinutes,
        originWait: `${originWait} mins`,
        transfers,
        steps: transitSteps,
        isFullyAccessible: originReport.status === "yes" && destReport.status === "yes",
      });
    } catch (err) {
      console.error("Error fetching directions:", err);
      setTripResult({
        originName: originStop.stop_name,
        destName: destStop.stop_name,
        originLat: oLat,
        originLon: oLon,
        destLat: dLat,
        destLon: dLon,
        primaryRoute,
        estMiles,
        estMinutes: 25,
        originWait: `${originWait} mins`,
        transfers,
        steps: transitSteps,
        isFullyAccessible: originReport.status === "yes" && destReport.status === "yes",
      });
    }
  };

  const filteredOriginStops = originSearch.trim() === ""
    ? []
    : stopsData.filter(s => 
        s.stop_name.toLowerCase().includes(originSearch.toLowerCase()) || 
        s.stop_id.toLowerCase().includes(originSearch.toLowerCase())
      ).slice(0, 6);

  const filteredDestinationStops = destinationSearch.trim() === ""
    ? []
    : stopsData.filter(s => 
        s.stop_name.toLowerCase().includes(destinationSearch.toLowerCase()) || 
        s.stop_id.toLowerCase().includes(destinationSearch.toLowerCase())
      ).slice(0, 6);

  return (
    <div style={{ width: "100%", minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
      {/* map Section */}
      <div style={{ position: "relative", width: "100%", height: "600px" }}>
        <div ref={mapContainerRef} style={{ width: "100%", height: "100%" }} />

        {/* map Legend */}
        <div
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            background: "rgba(255, 255, 255, 0.95)",
            padding: "10px 14px",
            borderRadius: "8px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            fontSize: "12px",
            fontFamily: "sans-serif",
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: "2px", color: "#1e293b" }}>Accessibility Legend</div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#1f77b4" }}></span>
            <span>Accessible</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#EF4444", border: "1px solid #991B1B" }}></span>
            <span style={{ fontWeight: "bold", color: "#991B1B" }}>Not Accessible</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#94A3B8" }}></span>
            <span style={{ color: "#64748b" }}>Unverified</span>
          </div>
        </div>

        {/* stop/ vehicle card*/}
        {selectedStop && (
          <div
            style={{
              position: "absolute",
              left: 20,
              bottom: 20,
              background: "white",
              padding: "14px 18px",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)",
              zIndex: 30,
              minWidth: "240px",
              maxWidth: "320px",
              fontFamily: "sans-serif",
            }}
          >
            <button
              onClick={() => {
                setSelectedStop(null);
                setShowUnknownModal(false);
              }}
              style={{ float: "right", border: "none", background: "none", cursor: "pointer", color: "#666", fontSize: "16px" }}
            >
              ✕
            </button>

            {selectedStop._isVehicle ? (
              <>
                <strong>Bus #{selectedStop.label}</strong>
                <div style={{ fontSize: "13px", color: "#334155", marginTop: "6px", lineHeight: "1.4" }}>
                  <strong>Line:</strong> {selectedStop.route_id}<br />
                  <strong>Current Speed:</strong> {selectedStop.speed} mph
                </div>
              </>
            ) : (
              <>
                <strong> {selectedStop.stop_name}</strong>
                <div style={{ fontSize: "12px", color: "#475569", marginTop: "6px", lineHeight: "1.5" }}>
                  Stop ID: {selectedStop.stop_id}<br />
                  Accessibility:{" "}
                  <strong style={{
                    color: selectedStop.wheelchair === "yes" ? "#166534" 
                         : selectedStop.wheelchair === "no" ? "#dc2626" 
                         : "#d97706"
                  }}>
                    {selectedStop.wheelchair === "yes" ? "Accessible" 
                     : selectedStop.wheelchair === "no" ? "Not Accessible" 
                     : " Unverified / Unknown"}
                  </strong><br />
                  Est. Next Arrival:{" "}
                  <strong style={{ color: "#0b132b" }}>
                    {selectedStop.waitMins !== null && selectedStop.waitMins !== undefined
                      ? `${selectedStop.waitMins} mins`
                      : "5 mins"}
                  </strong>
                </div>

                {selectedStop.note && (
                  <div style={{ marginTop: "8px", background: "#f8fafc", padding: "8px", borderRadius: "6px", border: "1px solid #e2e8f0", fontSize: "12px", color: "#334155" }}>
                    <strong>Note:</strong> {selectedStop.note}
                  </div>
                )}

                {selectedStop.photo && (
                  <div style={{ marginTop: "8px" }}>
                    <img src={selectedStop.photo} alt="Station accessibility" style={{ width: "100%", height: "110px", objectFit: "cover", borderRadius: "6px", border: "1px solid #cbd5e1" }} />
                  </div>
                )}

                <button
                  onClick={() => setShowUnknownModal(true)}
                  style={{
                    marginTop: "10px",
                    background: selectedStop.wheelchair === "unknown" ? "#fef3c7" : "#e0f2fe",
                    color: selectedStop.wheelchair === "unknown" ? "#92400e" : "#0369a1",
                    border: selectedStop.wheelchair === "unknown" ? "1px solid #fde68a" : "1px solid #bae6fd",
                    padding: "6px 10px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px"
                  }}
                >
                  {selectedStop.wheelchair === "unknown" ? "Verify Status" : "Report / Change Status"}
                </button>
              </>
            )}
          </div>
        )}

        {/* verify */}
        {showUnknownModal && selectedStop && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0, 0, 0, 0.4)",
              zIndex: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              style={{
                background: "white",
                padding: "24px 28px",
                borderRadius: "12px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
                maxWidth: "400px",
                width: "90%",
                fontFamily: "sans-serif",
                position: "relative",
              }}
            >
              <button
                onClick={() => setShowUnknownModal(false)}
                style={{
                  position: "absolute",
                  top: 14,
                  right: 14,
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: "16px",
                  color: "#666",
                }}
              >
                ✕
              </button>

              <div style={{ textAlign: "center", marginBottom: "16px" }}>
                <div style={{ fontSize: "28px", marginBottom: "4px" }}></div>
                <h3 style={{ margin: "0 0 6px 0", color: "#1e293b", fontSize: "17px" }}>
                  Update Station Accessibility
                </h3>
                <p style={{ margin: 0, color: "#64748b", fontSize: "13px" }}>
                  Updating accessibility info for <strong>{selectedStop.stop_name}</strong>
                </p>
              </div>

              {isSubmitted ? (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "16px", borderRadius: "8px", textAlign: "center" }}>
                  <div style={{ color: "#166534", fontWeight: "bold", fontSize: "14px", marginBottom: "4px" }}>Status Updated!</div>
                  <div style={{ color: "#15803d", fontSize: "12px", marginBottom: "14px" }}>
                    Station report, notes, and photos are now synced across devices.
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setIsSubmitted(false)}
                      style={{
                        flex: 1,
                        background: "#e0f2fe",
                        color: "#0369a1",
                        border: "none",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        fontWeight: "bold",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Change Again
                    </button>
                    <button
                      onClick={() => setShowUnknownModal(false)}
                      style={{
                        flex: 1,
                        background: "#166534",
                        color: "white",
                        border: "none",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        fontWeight: "bold",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleVerificationSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "bold", color: "#334155", display: "block", marginBottom: "6px" }}>
                      Is this stop wheelchair accessible?
                    </label>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <label style={{ flex: 1, display: "flex", alignItems: "center", gap: "6px", padding: "8px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", cursor: "pointer", background: verificationChoice === "1" ? "#f0fdf4" : "white" }}>
                        <input type="radio" name="accessibility" value="1" checked={verificationChoice === "1"} onChange={(e) => setVerificationChoice(e.target.value)} />
                        Accessible
                      </label>
                      <label style={{ flex: 1, display: "flex", alignItems: "center", gap: "6px", padding: "8px", border: "1px solid #cbd5e1", borderRadius: "6px", fontSize: "13px", cursor: "pointer", background: verificationChoice === "2" ? "#fef2f2" : "white" }}>
                        <input type="radio" name="accessibility" value="2" checked={verificationChoice === "2"} onChange={(e) => setVerificationChoice(e.target.value)} />
                         Not Accessible
                      </label>
                    </div>
                  </div>

                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "bold", color: "#334155", display: "block", marginBottom: "4px" }}>
                      Notes or Observations
                    </label>
                    <textarea
                      value={verificationNote}
                      onChange={(e) => setVerificationNote(e.target.value)}
                      placeholder="e.x., elevator broken, snow pile blocking stop, etc"
                      style={{ width: "100%", padding: "8px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "13px", boxSizing: "border-box", resize: "vertical", minHeight: "50px" }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: "12px", fontWeight: "bold", color: "#334155", display: "block", marginBottom: "4px" }}>
                      Upload Photo Evidence
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      style={{ fontSize: "12px", color: "#475569" }}
                    />
                  </div>

                  <button
                    type="submit"
                    style={{
                      background: "#540804",
                      color: "white",
                      border: "none",
                      padding: "10px",
                      borderRadius: "6px",
                      fontWeight: "bold",
                      fontSize: "14px",
                      cursor: "pointer",
                      marginTop: "4px",
                    }}
                  >
                    Submit Report
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      {/* trip planner */}
      <div
        style={{
          width: "100%",
          background: "#ffffff",
          padding: "20px 24px",
          boxShadow: "0 -2px 10px rgba(0,0,0,0.1)",
          fontFamily: "sans-serif",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0, fontSize: "16px", color: "#0f172a" }}> Trip Planner</h3>
          <button
            type="button"
            onClick={handleUseGPS}
            disabled={gpsLoading}
            style={{
              background: "#0b132b",
              color: "white",
              border: "none",
              padding: "8px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            {gpsLoading ? "Locating..." : "Use My Location"}
          </button>
        </div>

        <form onSubmit={handlePlanTrip} style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
            <label style={{ fontSize: "12px", fontWeight: "bold", color: "#475569", display: "block", marginBottom: "4px" }}>
              Starting Stop
            </label>
            <input
              type="text"
              value={originSearch}
              onChange={(e) => {
                setOriginSearch(e.target.value);
                setOriginId("");
                setShowOriginSuggestions(true);
              }}
              onFocus={() => setShowOriginSuggestions(true)}
              placeholder="Type station name or ID..."
              style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px", boxSizing: "border-box" }}
            />

            {showOriginSuggestions && filteredOriginStops.length > 0 && (
              <ul style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "white",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                margin: "4px 0 0 0",
                padding: 0,
                listStyle: "none",
                zIndex: 50,
                maxHeight: "180px",
                overflowY: "auto",
              }}>
                {filteredOriginStops.map((stop) => (
                  <li
                    key={`orig-sug-${stop.stop_id}`}
                    onClick={() => {
                      setOriginId(stop.stop_id);
                      setOriginSearch(`${stop.stop_name} (${stop.agency_prefix})`);
                      setShowOriginSuggestions(false);
                    }}
                    style={{ padding: "8px 12px", fontSize: "13px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                    onMouseEnter={(e) => e.target.style.background = "#f1f5f9"}
                    onMouseLeave={(e) => e.target.style.background = "white"}
                  >
                    <strong>{stop.stop_name}</strong> <span style={{ color: "#64748b", fontSize: "11px" }}>({stop.agency_prefix})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
            <label style={{ fontSize: "12px", fontWeight: "bold", color: "#475569", display: "block", marginBottom: "4px" }}>
              Destination Stop
            </label>
            <input
              type="text"
              value={destinationSearch}
              onChange={(e) => {
                setDestinationSearch(e.target.value);
                setDestinationId("");
                setShowDestinationSuggestions(true);
              }}
              onFocus={() => setShowDestinationSuggestions(true)}
              placeholder="Type station name or ID..."
              style={{ width: "100%", padding: "8px 12px", borderRadius: "6px", border: "1px solid #cbd5e1", fontSize: "14px", boxSizing: "border-box" }}
            />

            {showDestinationSuggestions && filteredDestinationStops.length > 0 && (
              <ul style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "white",
                border: "1px solid #cbd5e1",
                borderRadius: "6px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                margin: "4px 0 0 0",
                padding: 0,
                listStyle: "none",
                zIndex: 50,
                maxHeight: "180px",
                overflowY: "auto",
              }}>
                {filteredDestinationStops.map((stop) => (
                  <li
                    key={`dest-sug-${stop.stop_id}`}
                    onClick={() => {
                      setDestinationId(stop.stop_id);
                      setDestinationSearch(`${stop.stop_name} (${stop.agency_prefix})`);
                      setShowDestinationSuggestions(false);
                    }}
                    style={{ padding: "8px 12px", fontSize: "13px", cursor: "pointer", borderBottom: "1px solid #f1f5f9" }}
                    onMouseEnter={(e) => e.target.style.background = "#f1f5f9"}
                    onMouseLeave={(e) => e.target.style.background = "white"}
                  >
                    <strong>{stop.stop_name}</strong> <span style={{ color: "#64748b", fontSize: "11px" }}>({stop.agency_prefix})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="submit"
            style={{
              padding: "10px 20px",
              background: "#0b132b",
              color: "white",
              border: "none",
              borderRadius: "6px",
              fontWeight: "bold",
              cursor: "pointer",
              alignSelf: "flex-end",
              height: "38px",
            }}
          >
            Plan Route
          </button>
        </form>

        {tripResult && (
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              padding: "16px",
              borderRadius: "8px",
              marginTop: "16px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div>
                <div style={{ fontSize: "15px", fontWeight: "bold", color: "#1e293b" }}>
                  {tripResult.originName} ➔ {tripResult.destName}
                </div>
                <div style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>
                  Primary Line: <strong>{tripResult.primaryRoute}</strong> | 
                  Distance: ~{tripResult.estMiles} mi | Est. Time: ~{tripResult.estMinutes} mins | 
                  Est. Initial Wait: <strong>{tripResult.originWait}</strong>
                </div>
              </div>
              <div
                style={{
                  background: tripResult.isFullyAccessible ? "#dcfce7" : "#fee2e2",
                  color: tripResult.isFullyAccessible ? "#166534" : "#991b1b",
                  padding: "6px 12px",
                  borderRadius: "20px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  whiteSpace: "nowrap",
                }}
              >
                {tripResult.isFullyAccessible ? "Fully Accessible Route" : "Inaccessible Stops On Route"}
              </div>
            </div>

            <div style={{ marginTop: "12px", borderTop: "1px solid #e2e8f0", paddingTop: "10px" }}>
              <div style={{ fontSize: "13px", fontWeight: "bold", color: "#334155", marginBottom: "6px" }}>
             Route & Transfer Instructions:
              </div>
              <ol style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", color: "#475569", display: "flex", flexDirection: "column", gap: "6px" }}>
                {tripResult.steps.map((step, idx) => (
                  <li key={`step-${idx}`} style={{ fontWeight: step.includes("Transfer") ? "bold" : "normal", color: step.includes("Transfer") ? "#0284c7" : "#475569" }}>
                    {step}
                  </li>
                ))}
              </ol>
            </div>

            <a
              href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(tripResult.originLat)},${encodeURIComponent(tripResult.originLon)}&destination=${encodeURIComponent(tripResult.destLat)},${encodeURIComponent(tripResult.destLon)}&travelmode=transit`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                marginTop: "14px",
                background: "#0b132b",
                color: "white",
                padding: "10px 14px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "bold",
                textDecoration: "none",
                textAlign: "center",
              }}
            >
              Open Route in Google Maps
            </a>
          </div>
        )}
      </div>
    </div>
  );
}