"use client";

import { useEffect } from "react";

export const useAppVisualViewport = (): void => {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".app-viewport-shell");
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;

    const updateViewport = (): void => {
      if (window.matchMedia("(min-width: 760px)").matches) {
        shell.style.removeProperty("--app-viewport-height");
        shell.style.removeProperty("--app-viewport-top");
        return;
      }
      shell.style.setProperty("--app-viewport-height", `${viewport.height}px`);
      shell.style.setProperty("--app-viewport-top", `${viewport.offsetTop}px`);
    };

    updateViewport();
    viewport.addEventListener("resize", updateViewport);
    viewport.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      viewport.removeEventListener("resize", updateViewport);
      viewport.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
      shell.style.removeProperty("--app-viewport-height");
      shell.style.removeProperty("--app-viewport-top");
    };
  }, []);
};
