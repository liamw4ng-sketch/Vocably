import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AppVocabulario",
    short_name: "Vocabulario",
    description:
      "Extrae vocabulario en inglés de un PDF con la API de Claude y guárdalo para repasarlo.",
    start_url: "/repaso",
    display: "standalone",
    background_color: "#FBF7F1",
    theme_color: "#E1552C",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
