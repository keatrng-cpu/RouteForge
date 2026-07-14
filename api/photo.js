// RouteForge — exact-business photo resolver (Google Places).
//
// The client's photo chain tries this FIRST. It is the only source that can
// return a real photo of an arbitrary business (a specific café, a specific
// motel) rather than an encyclopedic landmark. It needs a Google Maps /
// Places API key; without one it returns 503 and the client falls back to
// the keyless, title-verified free sources (Wikipedia article → Wikimedia
// Commons → a clearly-labelled NEARBY area photo → a "see real photos" link).
//
// Honesty contract: we only ever return a photo Google actually attaches to
// the matched place. No key, no match, no photo → an explicit status, never
// an invented or mismatched image.

export const config = { maxDuration: 15 };

const PLACES = "https://places.googleapis.com/v1";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method-not-allowed" });
  }

  const key =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.PLACES_API_KEY;
  if (!key) return res.status(503).json({ error: "not-configured" });

  const q = req.query || {};
  const name = String(q.name || "").trim().slice(0, 160);
  const area = String(q.area || "").trim().slice(0, 160);
  if (!name) return res.status(400).json({ error: "missing-name" });
  const textQuery = [name, area].filter(Boolean).join(" ");

  try {
    // 1) find the place and its photo references
    const searchRes = await fetch(PLACES + "/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.photos",
      },
      body: JSON.stringify({ textQuery, maxResultCount: 1, languageCode: "en" }),
    });
    if (!searchRes.ok) {
      return res.status(502).json({ error: "search-failed", status: searchRes.status });
    }
    const search = await searchRes.json();
    const place = search.places && search.places[0];
    const photo = place && place.photos && place.photos[0];
    const maps =
      "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(textQuery) +
      (place && place.id ? "&query_place_id=" + encodeURIComponent(place.id) : "");
    if (!photo || !photo.name) {
      // no attached photo — hand the client the live Maps link to fall back to
      return res.status(404).json({ error: "no-photo", page: maps });
    }

    // 2) resolve the photo reference to a direct image URI (no redirect)
    const mediaRes = await fetch(
      PLACES + "/" + photo.name +
        "/media?maxWidthPx=800&skipHttpRedirect=true&key=" + encodeURIComponent(key)
    );
    if (!mediaRes.ok) {
      return res.status(502).json({ error: "media-failed", status: mediaRes.status, page: maps });
    }
    const media = await mediaRes.json();
    const src = media.photoUri;
    if (!src) return res.status(404).json({ error: "no-photo-uri", page: maps });

    // exact-business photos are stable — let the CDN cache hard
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=2592000");
    return res.status(200).json({
      src,
      page: maps,
      name: (place.displayName && place.displayName.text) || name,
      address: place.formattedAddress || null,
      source: "google-places",
    });
  } catch (err) {
    return res.status(502).json({ error: "unreachable", detail: String((err && err.message) || err) });
  }
}
