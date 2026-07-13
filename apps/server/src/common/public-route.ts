const publicHealthPaths = new Set([
  "/health/live",
  "/health/ready",
  "/api/health/live",
  "/api/health/ready"
]);

export function isPublicHealthPath(value: string): boolean {
  const path = value.split("?", 1)[0].replace(/\/+$/, "") || "/";
  return publicHealthPaths.has(path);
}
