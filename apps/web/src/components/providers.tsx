"use client";

import { Toaster } from "@Teekhi_Nazaar/ui/components/sonner";

import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    // The clay look is designed as a light theme; keep it fixed.
    <ThemeProvider attribute="class" forcedTheme="light" disableTransitionOnChange>
      {children}
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  );
}
