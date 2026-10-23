import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Urban Waste OS",
    short_name: "Urban Waste",
    description: "Connected waste collection and recycling operations.",
    start_url: "/login",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#2952cc",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
