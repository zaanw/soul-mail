"use client";
import { useEffect } from "react";
export function Pwa() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    const t = localStorage.getItem("soul-theme") || "dark";
    document.documentElement.dataset.theme =
      t === "system"
        ? matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : t;
  }, []);
  return null;
}
