import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SidePanel from "./SidePanel";
import "./sidepanel.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
