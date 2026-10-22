/** Linked attribution accompanies the static map as well as the credits baked into its pixels. */
export function JourneyMapCredits() {
  return (
    <p className="px-4 py-2 text-[10px] leading-relaxed text-ink-muted">
      Bản đồ hành trình: ©{" "}
      <a
        href="https://www.mapbox.com/about/maps/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Mapbox
      </a>
      {" · "}©{" "}
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        OpenStreetMap
      </a>
      {" · "}
      <a
        href="https://apps.mapbox.com/feedback/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
      >
        Cải thiện bản đồ
      </a>
    </p>
  );
}
