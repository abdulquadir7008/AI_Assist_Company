import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172026",
        muted: "#667085",
        line: "#d9e2e7",
        paper: "#f7f9fb",
        accent: "#0f766e",
        signal: "#b45309"
      },
      boxShadow: {
        panel: "0 12px 32px rgba(23, 32, 38, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
