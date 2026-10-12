import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Urban Waste OS",
    short_name: "Urban Waste",
    description: "Connected waste collection and recycling operations.",
    start_url: "/login",
    display: "standalone",
    background_color: "#f7f7f5",
    theme_color: "#151b2b",
  };
}
