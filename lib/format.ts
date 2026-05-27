export function formatTimer(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safeSeconds % 60).toString().padStart(2, "0");

  return `${minutes}:${seconds}`;
}

export function formatMeetingDate(isoDate: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(isoDate));
}

export function formatDuration(ms: number) {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));

  if (totalMinutes < 1) {
    return "under 1 min";
  }

  return `${totalMinutes} min`;
}
