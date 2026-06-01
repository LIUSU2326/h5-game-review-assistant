import { ProxyAgent, fetch as undiciFetch } from "undici";

export async function geminiFetch(url, { env = {}, timeoutMs = 60000, ...options } = {}) {
  const proxyUrl = findProxyUrl(env);
  const fetchOptions = {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (proxyUrl) fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
  return undiciFetch(url, fetchOptions);
}

export function findProxyUrl(env = {}) {
  return (
    env.GEMINI_PROXY ||
    env.HTTPS_PROXY ||
    env.HTTP_PROXY ||
    env.ALL_PROXY ||
    process.env.GEMINI_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    ""
  );
}

export function proxyStatus(env = {}) {
  const proxyUrl = findProxyUrl(env);
  return {
    enabled: Boolean(proxyUrl),
    value: maskProxyUrl(proxyUrl),
  };
}

function maskProxyUrl(value) {
  if (!value) return "";
  return value.replace(/\/\/([^/@]+)@/, "//***@");
}
