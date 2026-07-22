const configuredOrigin = import.meta.env.VITE_WORKER_ORIGIN?.trim();

export const workerOrigin = (configuredOrigin || "http://localhost:8787").replace(
  /\/$/,
  "",
);

const workerUrl = new URL(workerOrigin);

export const agentConnection = {
  host: workerUrl.host,
  protocol: workerUrl.protocol === "https:" ? ("wss" as const) : ("ws" as const),
};

export function createShareUrl(id: string): string {
  return `${workerOrigin}/view/${encodeURIComponent(id)}`;
}
