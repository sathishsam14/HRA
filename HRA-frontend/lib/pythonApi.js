// lib/pythonApi.js
// Server-only helper for resolving the Python backend base URL from PYTHON_API_URL (no trailing slash).

export function getPythonApiUrl() {
  const raw = process.env.PYTHON_API_URL || "http://127.0.0.1:8000";
  return raw.replace(/\/+$/, "");
}
