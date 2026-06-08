/// <reference types="vite/client" />

import type { ChaqApi } from "../preload";

declare global {
  interface Window {
    chaq: ChaqApi;
  }
}
