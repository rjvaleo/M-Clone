import React from "react";
import ReactDOM from "react-dom/client";
import { KitGallery } from "./modular/theme/kits/KitGallery";
import "./modular/ui/modular.css";
import "./modular/theme/kits/kitGallery.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <KitGallery />
  </React.StrictMode>,
);
