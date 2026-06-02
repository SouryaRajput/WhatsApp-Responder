import { io } from "socket.io-client";
import { API_BASE } from "./api";

export function createBrokerSocket() {
  return io(API_BASE, {
    withCredentials: true,
    transports: ["polling", "websocket"]
  });
}
