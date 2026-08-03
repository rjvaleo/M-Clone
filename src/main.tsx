import React from "react";
import ReactDOM from "react-dom/client";
import { ModularApp } from "./modular/ui/ModularApp";
import "./modular/ui/modular.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ModularApp />
  </React.StrictMode>,
);
