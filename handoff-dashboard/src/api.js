import axios from "axios";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true
});

export function setAuthToken() {
  // No-op for backwards compatibility, sessions handle auth now
}

export { API_BASE };
